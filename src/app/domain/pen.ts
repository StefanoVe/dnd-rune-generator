export type Point = readonly [number, number];
export type PenCommand =
  | { readonly op: 'M' | 'L'; readonly at: Point }
  | {
      readonly op: 'A';
      readonly radius: number;
      readonly large: 0 | 1;
      readonly sweep: 0 | 1;
      readonly at: Point;
    }
  | { readonly op: 'Z' | 'dot' };

/** Geometry is supplied in local coordinates, before any placement transform. */
export interface Pen {
  path(commands: readonly PenCommand[], transform?: string): string;
  line(from: Point, to: Point): string;
  polyline(points: readonly Point[], transform?: string): string;
  polygon(points: readonly Point[], transform?: string): string;
  circle(center: Point, radius: number, extra?: string): string;
  arc(from: Point, to: Point, radius: number, large: 0 | 1, sweep: 0 | 1): string;
  dot(at: Point): string;
  glyph(d: string, transform: string, center: Point): string;
}

const commandsFor = (points: readonly Point[]): PenCommand[] =>
  points.map((at, i) => ({ op: i === 0 ? 'M' : 'L', at }));

function cleanPath(commands: readonly PenCommand[], transform?: string): string {
  const d = commands
    .map((command) => {
      switch (command.op) {
        case 'M':
        case 'L':
          return `${command.op}${command.at[0]} ${command.at[1]}`;
        case 'A':
          return `A${command.radius} ${command.radius} 0 ${command.large} ${command.sweep} ${command.at[0]} ${command.at[1]}`;
        case 'Z':
          return 'Z';
        case 'dot':
          return 'h0';
      }
    })
    .join('');
  return `<path d="${d}"${transform ? ` transform="${transform}"` : ''}/>`;
}

export const cleanPen: Pen = {
  path: cleanPath,
  line: (from, to) => cleanPath(commandsFor([from, to])),
  polyline: (points, transform) => cleanPath(commandsFor(points), transform),
  polygon: (points, transform) => cleanPath([...commandsFor(points), { op: 'Z' }], transform),
  circle: ([x, y], radius, extra = '') => `<circle cx="${x}" cy="${y}" r="${radius}"${extra}/>`,
  arc: (from, to, radius, large, sweep) =>
    cleanPath([
      { op: 'M', at: from },
      { op: 'A', at: to, radius, large, sweep },
    ]),
  dot: (at) => cleanPath([{ op: 'M', at }, { op: 'dot' }]),
  glyph: (d, transform) =>
    `<path d="${d}" fill="currentColor" stroke="none" transform="${transform}"/>`,
};

// Distances are drawing units; widths are screen pixels before the 0.875 SVG scale.
export const BALLPOINT_WIDTH = 1.7;
export const DEFAULT_PEN_NOISE = 35;
export const MAX_WOBBLE = 244 * 0.04;
export const MAX_OVERSHOOT = 5;
export const INK_OPACITY = 0.96;
export const INK_SKIP_CHANCE = 0.035;
export const GRAIN_DISPLACEMENT = 0;
export const CYLINDER_WOBBLE = 1.8;
export const SPHERE_WOBBLE = 3;
export const SMALL_CIRCLE_WOBBLE = 1.6;
export const SAMPLE_SPACING = 8;
export const TREMOR_SPACING = 0.6; // At least four samples per 2.5-unit tremor cycle.
export const HATCH_SPACING = 2.6;
export const FLATTEN_TOLERANCE = 0.035;
const DRAWING_SCALE = 0.875;
const n = (value: number): number => Math.round(value * 100) / 100;
export function normalizePenNoise(value = DEFAULT_PEN_NOISE): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : DEFAULT_PEN_NOISE;
}
export function noiseFactor(value = DEFAULT_PEN_NOISE): number {
  return (normalizePenNoise(value) / DEFAULT_PEN_NOISE) ** 2;
}
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 0x01000193);
  return hash >>> 0;
}
function seededRandom(seed: string): () => number {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
export interface BallpointGesture {
  readonly points: readonly Point[];
  readonly widths: readonly number[];
  readonly opacities: readonly number[];
  readonly blot: boolean;
  readonly groove: boolean;
  readonly skip: boolean;
  readonly overlapDegrees: number;
  readonly startAngle?: number;
}
export type GestureShape =
  | {
      readonly kind: 'circle';
      readonly center: Point;
      readonly radius: number;
      readonly dashed?: boolean;
    }
  | { readonly kind: 'line'; readonly from: Point; readonly to: Point; readonly corner?: boolean }
  | { readonly kind: 'polyline'; readonly points: readonly Point[]; readonly detailScale: number }
  | {
      readonly kind: 'arc';
      readonly center: Point;
      readonly radius: number;
      readonly start: number;
      readonly sweep: number;
    };

/** Crowded circles reach their established envelope at 50, not already at 35. */
export function circleWobble(radius: number, dashed = false, penNoise = DEFAULT_PEN_NOISE): number {
  const factor = noiseFactor(penNoise);
  const tight =
    radius <= 18
      ? Math.min(SMALL_CIRCLE_WOBBLE, radius * 0.12)
      : radius === 206
        ? SPHERE_WOBBLE
        : [178, 192, 197, 207].includes(radius) && !dashed
          ? CYLINDER_WOBBLE
          : null;
  if (tight !== null) return (tight * factor) / noiseFactor(50);
  return Math.min(
    radius * 0.04 * factor,
    radius * (0.04 + 0.0007 * Math.max(0, normalizePenNoise(penNoise) - 35)),
  );
}
const mix = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const distance = (a: Point, b: Point): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
function lengthOf(points: readonly Point[]): number {
  return points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);
}
/** Never moves outer marks beyond the drawing's 292-unit half-viewBox, including ink. */
function insideDrawing(point: Point): Point {
  return [Math.max(-24, Math.min(536, point[0])), Math.max(-24, Math.min(536, point[1]))];
}

/** Same PRNG draws for every noise value. Sampling density changes only above 50. */
export function ballpointGesture(
  seed: string,
  shape: GestureShape,
  penNoise = DEFAULT_PEN_NOISE,
): readonly BallpointGesture[] {
  const noise = normalizePenNoise(penNoise),
    factor = noiseFactor(noise);
  const high = Math.max(0, (factor - noiseFactor(50)) / (noiseFactor(100) - noiseFactor(50)));
  const random = seededRandom(seed);
  const global =
    shape.kind === 'circle' || shape.kind === 'arc'
      ? shape.center[0] > 32 && shape.center[1] > 32
      : shape.kind === 'line'
        ? Math.max(...shape.from, ...shape.to) > 32
        : true;
  const direction = random() < 0.5 ? -1 : 1;
  const phase = random() * Math.PI * 2;
  const pressurePhase = random() * Math.PI * 2;
  const blotSample = random(),
    grooveSample = random(),
    skipSample = random();
  const tremor = (s: number, t: number, detail = 1): number =>
    high * 2.2 * detail * Math.sin(s * Math.PI * 0.8 + phase) * Math.sin(Math.PI * t);
  const finish = (
    points: readonly Point[],
    overlapDegrees = 0,
    startAngle?: number,
  ): BallpointGesture => {
    const length = lengthOf(points),
      spread = Math.min(0.2 * factor, 0.6);
    return {
      points: points.map((point) => {
        const [x, y] = global ? insideDrawing(point) : point;
        return [n(x), n(y)];
      }),
      widths: points.map((_, i) => {
        const t = i / (points.length - 1);
        const taper = 1 - Math.min(0.45, 0.2 * factor) * Math.max(0, (t - 0.88) / 0.12);
        return n(
          (BALLPOINT_WIDTH / DRAWING_SCALE) *
            (1 + spread * Math.cos(t * Math.PI * 2 + pressurePhase)) *
            taper,
        );
      }),
      opacities: points.map((_, i) => {
        const t = i / (points.length - 1);
        if (length < 100) return n(1 - 0.04 * Math.min(factor, 1));
        const fade = length > 400 ? 0.16 : 0.06;
        return n(1 - Math.min(fade, fade * factor) * Math.sin(Math.PI * t) ** 4);
      }),
      blot: blotSample < Math.min(0.6, 0.33 * factor),
      groove: factor > 0 && grooveSample < 0.18,
      skip: length > 100 && skipSample < Math.min(0.3, INK_SKIP_CHANCE * factor),
      overlapDegrees,
      startAngle,
    };
  };
  const step = high > 0 ? TREMOR_SPACING : SAMPLE_SPACING;
  if (shape.kind === 'line') {
    const length = distance(shape.from, shape.to);
    const ux = (shape.to[0] - shape.from[0]) / (length || 1),
      uy = (shape.to[1] - shape.from[1]) / (length || 1);
    const bend = direction * length * (0.006 + random() * 0.006) * factor;
    const drift = (((random() * 2 - 1) * Math.PI) / 180) * factor;
    const cornerSample = random(),
      extensionSample = random(),
      flickSample = random(),
      flickLength = random();
    const baseExtension =
      cornerSample < 0.15 ? -(1 + extensionSample * 1.5) : 2 + extensionSample * 3;
    const extension = shape.corner
      ? Math.sign(baseExtension) *
        Math.min(Math.abs(baseExtension) * factor, Math.max(Math.abs(baseExtension), length * 0.08))
      : 0;
    const flick =
      !shape.corner && flickSample < 0.3
        ? direction * Math.min((1.5 + flickLength * 1.5) * factor, Math.max(3, length * 0.06))
        : 0;
    const count = Math.max(2, Math.ceil(length / step));
    const points = Array.from({ length: count + 1 }, (_, i): Point => {
      const t = i / count;
      const along = (length + extension) * t;
      // Endpoint drift does not change the exact start of a gesture.
      const lateral =
        bend * Math.sin(Math.PI * t) +
        Math.tan(Math.min(0.12, Math.max(-0.12, drift))) * length * t +
        flick * Math.max(0, (t - 0.94) / 0.06) ** 2 +
        tremor(length * t, t, Math.min(1, length / 20));
      return [shape.from[0] + ux * along - uy * lateral, shape.from[1] + uy * along + ux * lateral];
    });
    return [finish(points)];
  }
  if (shape.kind === 'polyline') {
    const total = lengthOf(shape.points),
      amplitude = Math.min(0.7, shape.detailScale * 0.7) * factor;
    let traveled = 0;
    const points: Point[] = [shape.points[0]];
    for (let index = 1; index < shape.points.length; index++) {
      const a = shape.points[index - 1],
        b = shape.points[index],
        length = distance(a, b);
      const count = Math.max(1, Math.ceil(length / step));
      for (let i = 1; i <= count; i++) {
        const point = mix(a, b, i / count),
          s = traveled + (length * i) / count,
          t = s / (total || 1);
        const offset =
          amplitude * Math.sin(s / 14 + phase) * Math.sin(Math.PI * t) +
          tremor(s, t, Math.min(1, shape.detailScale));
        points.push([
          point[0] - ((b[1] - a[1]) / (length || 1)) * offset,
          point[1] + ((b[0] - a[0]) / (length || 1)) * offset,
        ]);
      }
      traveled += length;
    }
    return [finish(points)];
  }
  const { center, radius } = shape;
  const start = shape.kind === 'arc' ? shape.start : random() * Math.PI * 2;
  const rotation = random() * Math.PI * 2,
    small = radius <= 18;
  const oval = radius * (small ? 0.02 + random() * 0.02 : 0.0075 + random() * 0.0075) * factor;
  const wave = radius * (0.008 + random() * 0.004) * factor;
  const spiralBase = small ? radius * (0.04 + random() * 0.03) : radius * (0.012 + random() * 0.01);
  // At maximum noise a closing pass misses radially by 8–15 units on large rings.
  const spiral = spiralBase * factor;
  const overlapSample = random();
  const limit = circleWobble(radius, shape.kind === 'circle' && shape.dashed, noise);
  const envelope = oval + wave + spiral / 2;
  const restraint = envelope > 0 ? Math.min(1, limit / envelope) : 1;
  const curved = (begin: number, sweep: number, overlap: number): BallpointGesture => {
    const count = Math.max(
      Math.abs(sweep) > 3 ? 24 : 2,
      Math.ceil(
        (Math.abs(sweep) * radius) /
          (radius <= 18 && Math.abs(sweep) > 3 ? Math.min(3.5, step) : step),
      ),
    );
    const fullCircle = shape.kind === 'circle' && !shape.dashed && radius >= 100;
    const pitch = fullCircle
      ? spiral * restraint * (1 - high) + high * (9 + 5 * overlapSample) * (1 + overlap / 360)
      : spiral * restraint;
    const points = Array.from({ length: count + 1 }, (_, i): Point => {
      const t = i / count,
        angle = begin + sweep * t;
      const radial =
        restraint *
          (oval * Math.cos(2 * (angle - rotation)) + wave * Math.sin(3 * (angle - rotation))) +
        direction * pitch * (t - 0.5) +
        tremor(radius * sweep * t, t, Math.min(1, radius / 18));
      const r = radius + radial;
      return [center[0] + r * Math.cos(angle), center[1] + r * Math.sin(angle)];
    });
    return finish(points, overlap, begin);
  };
  if (shape.kind === 'arc') return [curved(start, shape.sweep, 0)];
  if (shape.dashed) {
    const count = Math.floor((2 * Math.PI * radius) / 19);
    return Array.from({ length: count }, (_, i) =>
      curved(start + (i * Math.PI * 2) / count, 10 / radius, 0),
    );
  }
  const overlap =
    (small ? 20 + overlapSample * 40 : 15 + overlapSample * 20) * Math.min(factor, 1.5);
  return [curved(start, ((360 + overlap) * Math.PI) / 180, overlap)];
}

export interface PathTransform {
  readonly scale: number;
  readonly dx: number;
  readonly dy: number;
}
const flatCache = new Map<string, readonly (readonly Point[])[]>();
/** SVG's default nonzero fill rule is used by all school paths (no fill-rule override). */
export function flattenSvgPath(
  d: string,
  transform: PathTransform = { scale: 1, dx: 0, dy: 0 },
  tolerance = FLATTEN_TOLERANCE,
): readonly (readonly Point[])[] {
  const key = `${transform.scale}|${tolerance}|${d}`;
  let flat = flatCache.get(key);
  if (!flat) {
    const tokens = d.match(/[a-df-zA-DF-Z]|[-+]?(?:\d*\.?\d+)(?:[eE][-+]?\d+)?/g) ?? [];
    let index = 0,
      command = '',
      current: Point = [0, 0],
      start = current,
      previous = '';
    let cubic: Point = current,
      quadratic: Point = current;
    const contours: Point[][] = [];
    let points: Point[] = [];
    const scaled = ([x, y]: Point): Point => [x * transform.scale, y * transform.scale];
    const read = (): number => {
      const value = Number(tokens[index++]);
      if (!Number.isFinite(value)) throw new Error('Invalid SVG path number');
      return value;
    };
    const readFlag = (): number => {
      const token = tokens[index];
      if (!/^[01]/.test(token ?? '')) throw new Error('Invalid SVG arc flag');
      const flag = Number(token[0]);
      if (token.length === 1) index++;
      else tokens[index] = token.slice(1);
      return flag;
    };
    const target = (relative: boolean): Point => {
      const point: Point = [read(), read()];
      return relative ? [point[0] + current[0], point[1] + current[1]] : point;
    };
    const append = (point: Point): void => {
      points.push(scaled(point));
      current = point;
    };
    const chordDistance = (point: Point, a: Point, b: Point): number =>
      distance(a, b) < 1e-10
        ? distance(point, a)
        : Math.abs((b[0] - a[0]) * (a[1] - point[1]) - (a[0] - point[0]) * (b[1] - a[1])) /
          distance(a, b);
    const flattenCubic = (a: Point, b: Point, c: Point, end: Point, depth = 0): void => {
      if (
        depth >= 18 ||
        (Math.max(
          chordDistance(scaled(b), scaled(a), scaled(end)),
          chordDistance(scaled(c), scaled(a), scaled(end)),
        ) <= tolerance &&
          (distance(a, b) + distance(b, c) + distance(c, end) - distance(a, end)) *
            Math.abs(transform.scale) <=
            tolerance)
      ) {
        points.push(scaled(end));
        return;
      }
      const ab = mix(a, b, 0.5),
        bc = mix(b, c, 0.5),
        ce = mix(c, end, 0.5),
        abc = mix(ab, bc, 0.5),
        bce = mix(bc, ce, 0.5),
        middle = mix(abc, bce, 0.5);
      flattenCubic(a, ab, abc, middle, depth + 1);
      flattenCubic(middle, bce, ce, end, depth + 1);
    };
    while (index < tokens.length) {
      if (/^[a-z]$/i.test(tokens[index])) command = tokens[index++];
      if (!command) throw new Error('SVG path must start with a command');
      const op = command.toUpperCase(),
        relative = command !== op;
      const from = current;
      if (op === 'Z') {
        append(start);
        if (points.length) contours.push(points);
        points = [];
        current = start;
        command = '';
        previous = 'Z';
        continue;
      }
      if (op === 'M') {
        const end = target(relative);
        if (points.length) contours.push(points);
        points = [];
        append(end);
        start = end;
        command = relative ? 'l' : 'L';
      } else if (op === 'L') append(target(relative));
      else if (op === 'H') append([read() + (relative ? current[0] : 0), current[1]]);
      else if (op === 'V') append([current[0], read() + (relative ? current[1] : 0)]);
      else if (op === 'C' || op === 'S') {
        const control1 =
          op === 'C'
            ? target(relative)
            : previous === 'C' || previous === 'S'
              ? ([2 * current[0] - cubic[0], 2 * current[1] - cubic[1]] as Point)
              : current;
        const control2 = target(relative),
          end = target(relative);
        flattenCubic(current, control1, control2, end);
        current = end;
        cubic = control2;
      } else if (op === 'Q' || op === 'T') {
        const control =
          op === 'Q'
            ? target(relative)
            : previous === 'Q' || previous === 'T'
              ? ([2 * current[0] - quadratic[0], 2 * current[1] - quadratic[1]] as Point)
              : current;
        const end = target(relative);
        flattenCubic(current, mix(current, control, 2 / 3), mix(end, control, 2 / 3), end);
        current = end;
        quadratic = control;
      } else if (op === 'A') {
        let rx = Math.abs(read()),
          ry = Math.abs(read());
        const rotation = (read() * Math.PI) / 180,
          large = readFlag(),
          sweep = readFlag(),
          end = target(relative);
        if (!rx || !ry || distance(from, end) < 1e-10) append(end);
        else {
          const cos = Math.cos(rotation),
            sin = Math.sin(rotation);
          const xp = (cos * (from[0] - end[0])) / 2 + (sin * (from[1] - end[1])) / 2;
          const yp = (-sin * (from[0] - end[0])) / 2 + (cos * (from[1] - end[1])) / 2;
          const ratio = (xp * xp) / (rx * rx) + (yp * yp) / (ry * ry);
          if (ratio > 1) {
            rx *= Math.sqrt(ratio);
            ry *= Math.sqrt(ratio);
          }
          const coefficient =
            (large === sweep ? -1 : 1) *
            Math.sqrt(
              Math.max(
                0,
                (rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp) /
                  (rx * rx * yp * yp + ry * ry * xp * xp),
              ),
            );
          const cxp = (coefficient * rx * yp) / ry,
            cyp = (-coefficient * ry * xp) / rx;
          const cx = cos * cxp - sin * cyp + (from[0] + end[0]) / 2,
            cy = sin * cxp + cos * cyp + (from[1] + end[1]) / 2;
          const angle = Math.atan2((yp - cyp) / ry, (xp - cxp) / rx);
          let extent = Math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx) - angle;
          if (sweep && extent < 0) extent += 2 * Math.PI;
          if (!sweep && extent > 0) extent -= 2 * Math.PI;
          const count = Math.max(
            1,
            Math.ceil(
              Math.abs(extent) /
                (2 *
                  Math.acos(
                    Math.max(-1, 1 - tolerance / (Math.max(rx, ry) * Math.abs(transform.scale))),
                  )),
            ),
          );
          for (let i = 1; i <= count; i++) {
            const a = angle + (extent * i) / count;
            points.push(
              scaled([
                cx + cos * rx * Math.cos(a) - sin * ry * Math.sin(a),
                cy + sin * rx * Math.cos(a) + cos * ry * Math.sin(a),
              ]),
            );
          }
          current = end;
        }
      } else throw new Error(`Unsupported SVG command ${command}`);
      previous = op;
    }
    if (points.length) contours.push(points);
    flat = contours;
    if (flatCache.size >= 256) flatCache.clear();
    flatCache.set(key, flat);
  }
  return flat.map((contour) =>
    contour.map(([x, y]): Point => [x + transform.dx, y + transform.dy]),
  );
}

export function pointInPolygons(
  point: Point,
  contours: readonly (readonly Point[])[],
  rule: 'nonzero' | 'evenodd' = 'nonzero',
): boolean {
  let winding = 0;
  for (const contour of contours)
    for (let i = 0; i < contour.length; i++) {
      const a = contour[i],
        b = contour[(i + 1) % contour.length];
      const cross = (b[0] - a[0]) * (point[1] - a[1]) - (point[0] - a[0]) * (b[1] - a[1]);
      if (a[1] <= point[1] && b[1] > point[1] && cross > 0) winding++;
      if (a[1] > point[1] && b[1] <= point[1] && cross < 0) winding--;
    }
  return rule === 'nonzero' ? winding !== 0 : Math.abs(winding) % 2 === 1;
}
export function hatchPolygons(
  contours: readonly (readonly Point[])[],
  spacing: number,
  angle: number,
): readonly (readonly [Point, Point])[] {
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const rotated = contours.map((contour) =>
    contour.map(([x, y]): Point => [cos * x + sin * y, -sin * x + cos * y]),
  );
  const ys = rotated.flat().map((point) => point[1]);
  const lines: [Point, Point][] = [];
  const back = (x: number, y: number): Point => [cos * x - sin * y, sin * x + cos * y];
  for (let y = Math.ceil(Math.min(...ys) / spacing) * spacing; y < Math.max(...ys); y += spacing) {
    const hits: { x: number; winding: number }[] = [];
    for (const contour of rotated)
      for (let i = 0; i < contour.length; i++) {
        const a = contour[i],
          b = contour[(i + 1) % contour.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
          hits.push({
            x: a[0] + ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]),
            winding: b[1] > a[1] ? 1 : -1,
          });
      }
    hits.sort((a, b) => a.x - b.x);
    let winding = 0;
    for (let i = 0; i < hits.length - 1; i++) {
      winding += hits[i].winding;
      if (winding !== 0 && hits[i + 1].x - hits[i].x > 0.05)
        lines.push([back(hits[i].x, y), back(hits[i + 1].x, y)]);
    }
  }
  return lines;
}

export function ballpointPen(seed: string, penNoise = DEFAULT_PEN_NOISE): Pen {
  const noise = normalizePenNoise(penNoise),
    factor = noiseFactor(noise);
  const random = seededRandom(seed);
  const signed = (a: number): number => (random() * 2 - 1) * a;
  let serial = 0,
    glyphSerial = 0;
  const next = (shape: GestureShape): readonly BallpointGesture[] =>
    ballpointGesture(`${seed}:${serial++}`, shape, noise);
  const pathData = (points: readonly Point[]): string => {
    if (!points.length) return '';
    const rounded = points.map(([x, y]): Point => [n(x), n(y)]);
    return (
      `M${rounded[0][0]} ${rounded[0][1]}` +
      (rounded.length > 1 ? 'l' : '') +
      rounded
        .slice(1)
        .map(([x, y], i) => `${n(x - rounded[i][0])} ${n(y - rounded[i][1])}`)
        .join(' ')
    ).replace(/ (?=-)/g, '');
  };
  const mark = (markup: string): string => `<g data-pen-noise="${noise}">${markup}</g>`;
  const draw = (gestures: readonly BallpointGesture[], widthScale = 1, kind = ''): string =>
    gestures
      .map((gesture) => {
        const { points, widths, opacities } = gesture;
        const zones = noise === 0 ? 1 : points.length > 25 ? 3 : 1;
        let markup = '';
        for (let zone = 0; zone < zones; zone++) {
          const first = Math.floor((zone * (points.length - 1)) / zones),
            last = Math.floor(((zone + 1) * (points.length - 1)) / zones),
            middle = Math.floor((first + last) / 2);
          const local = points.slice(first, last + 1);
          if (gesture.skip && zone === 1 && local.length > 1) {
            const length = distance(local[0], local[1]);
            local[0] = mix(local[0], local[1], Math.min(0.9, (2 * Math.min(factor, 1.5)) / length));
          }
          markup += `<path d="${pathData(local)}" stroke-width="${n(widths[middle] * widthScale)}" ${kind === 'hatch' ? '' : `stroke-opacity="${opacities[middle]}"`}/>`;
        }
        if (gesture.groove) {
          const first = Math.floor(points.length * 0.25),
            last = Math.max(first + 1, Math.floor(points.length * 0.42));
          const a = points[first],
            b = points[Math.min(last, points.length - 1)],
            length = distance(a, b) || 1;
          const offset = Math.min(0.4, 0.4 * factor) * widthScale;
          const groove = points
            .slice(first, last + 1)
            .map(([x, y]): Point => [
              x - ((b[1] - a[1]) / length) * offset,
              y + ((b[0] - a[0]) / length) * offset,
            ]);
          markup += `<path data-pen-event="groove" d="${pathData(groove)}" stroke-width="${n(0.35 * Math.min(factor, 1) * widthScale)}" stroke-opacity=".95"/>`;
        }
        if (gesture.blot)
          markup += `<path data-pen-event="blot" d="M${points[0][0]} ${points[0][1]}h0" stroke-width="${n(widths[0] * widthScale * (1 + 0.35 * Math.min(factor, 2)))}" stroke-opacity=".98"/>`;
        return kind === 'outline' ? `<g data-pen-part="outline">${markup}</g>` : markup;
      })
      .join('')
      .replace(/([MLl "=])(-?)0\./g, '$1$2.');
  const segment = (from: Point, to: Point, corner = false): string =>
    draw(next({ kind: 'line', from, to, corner }));
  const circle = (center: Point, radius: number, extra = ''): string => {
    const gestures = next({
      kind: 'circle',
      center,
      radius,
      dashed: extra.includes('stroke-dasharray'),
    });
    if (noise === 0)
      return mark(
        `<circle cx="${center[0]}" cy="${center[1]}" r="${radius}" stroke-width="${n(BALLPOINT_WIDTH / DRAWING_SCALE)}"${extra}/>`,
      );
    return mark(draw(gestures));
  };
  const dot = (at: Point): string =>
    `<path d="M${at[0]} ${at[1]}h0" stroke-width="${n(BALLPOINT_WIDTH / DRAWING_SCALE)}"/>`;
  const arc = (from: Point, to: Point, radius: number, large: 0 | 1, sweep: 0 | 1): string => {
    const dx = to[0] - from[0],
      dy = to[1] - from[1],
      chord = distance(from, to);
    if (!chord) return circle(from, radius);
    const r = Math.max(radius, chord / 2),
      h = Math.sqrt(Math.max(0, r * r - (chord * chord) / 4)),
      sign = large === sweep ? -1 : 1;
    const center: Point = [
      (from[0] + to[0]) / 2 - (sign * dy * h) / chord,
      (from[1] + to[1]) / 2 + (sign * dx * h) / chord,
    ];
    const start = Math.atan2(from[1] - center[1], from[0] - center[0]);
    let extent = Math.atan2(to[1] - center[1], to[0] - center[0]) - start;
    if (sweep && extent < 0) extent += Math.PI * 2;
    if (!sweep && extent > 0) extent -= Math.PI * 2;
    const gestures = next({ kind: 'arc', center, radius: r, start, sweep: extent });
    return noise === 0 ? cleanPen.arc(from, to, radius, large, sweep) : draw(gestures);
  };
  const path = (commands: readonly PenCommand[], transform?: string): string => {
    let at: Point = [0, 0],
      start = at,
      markup = '';
    const closed = commands.some((command) => command.op === 'Z');
    for (const command of commands)
      switch (command.op) {
        case 'M':
          at = start = command.at;
          break;
        case 'L':
          markup += segment(at, command.at, closed);
          at = command.at;
          break;
        case 'A':
          markup += arc(at, command.at, command.radius, command.large, command.sweep);
          at = command.at;
          break;
        case 'Z':
          if (distance(at, start) > 0.1) markup += segment(at, start, true);
          break;
        case 'dot':
          markup += dot(at);
          break;
      }
    if (transform) {
      const pivot = transform.match(/^rotate\([-\d.]+ ([-\d.]+) ([-\d.]+)\)$/);
      const before = pivot ? `translate(${pivot[1]} ${pivot[2]}) ` : '',
        after = pivot ? ` translate(${-Number(pivot[1])} ${-Number(pivot[2])})` : '';
      const variation = Math.min(factor, 2.5);
      markup = `<g transform="${transform} translate(${n(signed(0.6) * variation)} ${n(signed(0.6) * variation)}) ${before}rotate(${n(signed(6) * variation)}) scale(${n(1 + signed(0.08) * variation)})${after}">${markup}</g>`;
    }
    if (noise === 0)
      return mark(
        `<g stroke-width="${n(BALLPOINT_WIDTH / DRAWING_SCALE)}">${cleanPath(commands, transform)}</g>`,
      );
    return mark(markup);
  };
  const glyph = (d: string, transform: string, [cx, cy]: Point): string => {
    const glyphSeed = `${seed}:glyph:${glyphSerial++}`;
    const glyphRandom = seededRandom(glyphSeed);
    const signed = (a: number): number => (glyphRandom() * 2 - 1) * a;
    const random = glyphRandom;
    let gestureIndex = 0;
    const next = (shape: GestureShape): readonly BallpointGesture[] =>
      ballpointGesture(`${glyphSeed}:${gestureIndex++}`, shape, noise);
    const placement = transform.match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/);
    if (!placement) throw new Error('Expected school glyph translation and scale');
    const contours = flattenSvgPath(d, {
      dx: Number(placement[1]),
      dy: Number(placement[2]),
      scale: Number(placement[3]),
    });
    const all = contours.flat(),
      xs = all.map((point) => point[0]),
      ys = all.map((point) => point[1]);
    const box = {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    };
    const size = Math.max(box.right - box.left, box.bottom - box.top),
      detail = Math.min(1, size / 102);
    const widthScale = Math.max(0.28, Math.min(0.75, detail));
    // Consume the same placement/angle draws even at zero noise.
    const angle = Math.PI / 4 + ((signed(5) * Math.PI) / 180) * Math.min(factor, 2);
    const rotation = ((signed(2.5) * Math.PI) / 180) * Math.min(factor, 2),
      dx = signed(0.35) * Math.min(factor, 2) * detail,
      dy = signed(0.35) * Math.min(factor, 2) * detail;
    const vary = ([x, y]: Point): Point =>
      insideDrawing([
        cx + dx + (x - cx) * Math.cos(rotation) - (y - cy) * Math.sin(rotation),
        cy + dy + (x - cx) * Math.sin(rotation) + (y - cy) * Math.cos(rotation),
      ]);
    let markup = contours
      .map((points) =>
        draw(
          next({ kind: 'polyline', points: points.map(vary), detailScale: detail }),
          widthScale,
          'outline',
        ),
      )
      .join('');
    const spacing = Math.max(
      1.6,
      (BALLPOINT_WIDTH / DRAWING_SCALE) * HATCH_SPACING * Math.max(0.33, detail),
    );
    const hatch = hatchPolygons(contours, spacing, angle);
    let hatchMarkup = '';
    for (const [from, to] of hatch) {
      const length = distance(from, to);
      const shorten = (random() < 0.8 ? 0.5 + random() : -random() * 0.25) * factor;
      const reverse = random() < 0.3;
      if (length < 0.4) continue;
      const inset = Math.max(-0.25, Math.min(length * 0.25, shorten));
      const a = mix(from, to, inset / length),
        b = mix(to, from, inset / length);
      const hatchPoints = reverse ? [vary(b), vary(a)] : [vary(a), vary(b)];
      let gestures = next({
        kind: 'polyline',
        points: hatchPoints,
        detailScale: Math.min(detail, length / 70),
      });
      // Bound hatching to its transformed glyph box; the outline alone may overshoot.
      const corners = (
        [
          [box.left, box.top],
          [box.right, box.top],
          [box.right, box.bottom],
          [box.left, box.bottom],
        ] as readonly Point[]
      ).map(vary);
      const minX = Math.min(...corners.map((point) => point[0])),
        maxX = Math.max(...corners.map((point) => point[0]));
      const minY = Math.min(...corners.map((point) => point[1])),
        maxY = Math.max(...corners.map((point) => point[1]));
      gestures = gestures.map((gesture) => ({
        ...gesture,
        points: gesture.points.map(([x, y]): Point => [
          Math.max(minX, Math.min(maxX, x)),
          Math.max(minY, Math.min(maxY, y)),
        ]),
      }));
      hatchMarkup += draw(gestures, widthScale * 0.8, 'hatch');
    }
    // Batch independent short gestures with the same pressure bucket. This keeps all
    // centerlines and localized ink events while avoiding repeated SVG attributes.
    const buckets = new Map<number, string[]>();
    const events = hatchMarkup.replace(
      /<path d="([^"]+)" stroke-width="([^"]+)"\s*\/>/g,
      (_, d: string, width: string) => {
        const value = noise === 0 ? Number(width) : n(Math.round(Number(width) / 0.05) * 0.05);
        const paths = buckets.get(value) ?? [];
        paths.push(d);
        buckets.set(value, paths);
        return '';
      },
    );
    const batched = [...buckets]
      .map(([width, paths]) => `<path d="${paths.join('')}" stroke-width="${width}"/>`)
      .join('');
    return mark(
      `<g data-school-glyph="outline-hatch">${markup}<g data-pen-part="hatch" stroke-opacity="${n(1 - 0.04 * Math.min(factor, 1))}">${batched}${events}</g></g>`,
    );
  };
  return {
    path,
    line: (from, to) => mark(segment(from, to)),
    polyline: (points, transform) => path(commandsFor(points), transform),
    polygon: (points, transform) => path([...commandsFor(points), { op: 'Z' }], transform),
    circle,
    arc,
    dot,
    glyph,
  };
}
