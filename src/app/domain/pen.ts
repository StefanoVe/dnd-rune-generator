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

// Drawing units unless stated otherwise; the SVG applies a 0.875 scale.
export const BALLPOINT_WIDTH = 1.7; // screen pixels
export const MAX_WOBBLE = 244 * 0.04; // seal's absolute radial envelope
export const MAX_OVERSHOOT = 5;
export const INK_OPACITY = 0.96;
export const INK_SKIP_CHANCE = 0.035;
export const SAMPLE_SPACING = 8;
export const GRAIN_DISPLACEMENT = 0.8;
export const CYLINDER_WOBBLE = 1.8;
export const SPHERE_WOBBLE = 3;
export const SMALL_CIRCLE_WOBBLE = 1.6;
const DRAWING_SCALE = 0.875;
const n = (value: number): number => Math.round(value * 100) / 100;

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
  readonly grooveOpacities: readonly number[];
  readonly blot: boolean;
  readonly overlapDegrees: number;
}
export type GestureShape =
  | {
      readonly kind: 'circle';
      readonly center: Point;
      readonly radius: number;
      readonly dashed?: boolean;
    }
  | { readonly kind: 'line'; readonly from: Point; readonly to: Point; readonly corner?: boolean }
  | {
      readonly kind: 'arc';
      readonly center: Point;
      readonly radius: number;
      readonly start: number;
      readonly sweep: number;
    };

/** Element-specific envelopes preserve the ten-unit cylinder gap and the script-band gap.
 * Large unconstrained circles retain the full relative deformation; only crowded elements
 * (cylinder, sphere, tiny beads/nodes) are capped individually.
 */
export function circleWobble(radius: number, dashed = false): number {
  if (dashed && radius === 192) return radius * 0.04;
  if (radius === 197 || radius === 207 || radius === 178 || radius === 192) return CYLINDER_WOBBLE;
  if (radius === 206) return SPHERE_WOBBLE;
  if (radius <= 18) return Math.min(SMALL_CIRCLE_WOBBLE, radius * 0.12);
  return radius * 0.04;
}

/** The renderer and tests consume these same centerlines, pressures and ink densities. */
export function ballpointGesture(seed: string, shape: GestureShape): readonly BallpointGesture[] {
  const random = seededRandom(seed);
  const signed = (a: number): number => (random() * 2 - 1) * a;
  const direction = random() < 0.5 ? -1 : 1;
  const finish = (points: readonly Point[], overlapDegrees = 0): BallpointGesture => {
    const phase = random() * Math.PI * 2;
    const pressure = 0.94 + random() * 0.12;
    return {
      points: points.map(([x, y]) => [n(x), n(y)]),
      widths: points.map((_, i) => {
        const t = i / (points.length - 1);
        const taper = t > 0.87 ? 1 - 0.76 * ((t - 0.87) / 0.13) : 1;
        return n(
          (BALLPOINT_WIDTH / DRAWING_SCALE) *
            pressure *
            (1 + 0.25 * Math.cos(t * Math.PI * 2 + phase)) *
            taper,
        );
      }),
      opacities: points.map((_, i) => {
        const t = i / (points.length - 1);
        return n(0.72 + 0.24 * Math.abs(2 * t - 1) ** 1.4);
      }),
      grooveOpacities: points.map((_, i) =>
        n(0.25 + 0.25 * Math.sin((Math.PI * i) / (points.length - 1)) ** 2),
      ),
      blot: random() < 0.33,
      overlapDegrees,
    };
  };
  if (shape.kind === 'line') {
    const { from, to } = shape;
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const ux = (to[0] - from[0]) / (length || 1),
      uy = (to[1] - from[1]) / (length || 1);
    const bend = direction * length * (0.006 + random() * 0.006);
    const drift = (signed(0.5 + random() * 0.5) * Math.PI) / 180;
    const extension = shape.corner
      ? random() < 0.15
        ? -(1 + random() * 1.5)
        : 2 + random() * 3
      : 0;
    const flick = !shape.corner && random() < 0.3 ? direction * (1.5 + random() * 1.5) : 0;
    const count = Math.max(2, Math.ceil(length / SAMPLE_SPACING));
    const points = Array.from({ length: count + 1 }, (_, i): Point => {
      const t = i / count;
      const along = (length + extension) * t;
      const lateral =
        bend * Math.sin(Math.PI * t) +
        Math.tan(drift) * length * (t - 0.5) +
        flick *
          Math.max(0, (t - (1 - Math.min(0.12, 6 / length))) / Math.min(0.12, 6 / length)) ** 2;
      return [from[0] + ux * along - uy * lateral, from[1] + uy * along + ux * lateral];
    });
    return [finish(points)];
  }
  const { center, radius } = shape;
  const start = shape.kind === 'arc' ? shape.start : random() * Math.PI * 2;
  const rotation = random() * Math.PI * 2;
  const small = radius <= 18;
  const oval = radius * (small ? 0.02 + random() * 0.02 : 0.0075 + random() * 0.0075);
  const wave = radius * (0.008 + random() * 0.004);
  const spiral = radius * (small ? 0.04 + random() * 0.03 : 0.012 + random() * 0.01);
  const limit = circleWobble(radius, shape.kind === 'circle' && shape.dashed);
  const profile = (angle: number, t: number): number =>
    oval * Math.cos(2 * (angle - rotation)) +
    wave * Math.sin(3 * (angle - rotation)) +
    direction * spiral * (t - 0.5);
  const envelope = oval + wave + spiral / 2;
  const restraint = Math.min(1, (limit - (radius >= 100 ? 0.35 : 0.04)) / envelope);
  const curved = (
    begin: number,
    sweep: number,
    gestureIndex: number,
    overlap: number,
  ): BallpointGesture => {
    const count = Math.max(
      Math.abs(sweep) > 3 ? 20 : 2,
      Math.ceil(
        (Math.abs(sweep) * radius) / (radius <= 18 && Math.abs(sweep) > 3 ? 3.5 : SAMPLE_SPACING),
      ),
    );
    const points = Array.from({ length: count + 1 }, (_, i): Point => {
      const t = i / count;
      const angle = begin + sweep * t;
      const globalT = (angle - start) / (2 * Math.PI);
      const join = radius === 244 ? (gestureIndex === 0 ? -0.65 : 0.65) : 0;
      const flick = Math.max(0, (t - 0.9) / 0.1) ** 2 * direction * Math.min(radius * 0.003, 0.5);
      const radial = Math.max(
        -limit,
        Math.min(limit, profile(angle, globalT) * restraint + join + flick),
      );
      const r = radius + radial;
      return [center[0] + r * Math.cos(angle), center[1] + r * Math.sin(angle)];
    });
    // An angled entry hook, constrained separately for tiny circles.
    const hook = Math.min(radius * 0.012, 3);
    const entry: Point = [
      points[0][0] - hook * Math.cos(begin + 0.6) - center[0],
      points[0][1] - hook * Math.sin(begin + 0.6) - center[1],
    ];
    const entryRadius = Math.hypot(...entry);
    const boundedRadius = Math.max(radius - limit, Math.min(radius + limit, entryRadius));
    points.unshift([
      center[0] + (entry[0] * boundedRadius) / entryRadius,
      center[1] + (entry[1] * boundedRadius) / entryRadius,
    ]);
    return finish(points, overlap);
  };
  if (shape.kind === 'arc') return [curved(start, shape.sweep, 0, 0)];
  if (shape.dashed) {
    const count = Math.floor((2 * Math.PI * radius) / 19);
    return Array.from({ length: count }, (_, i) =>
      curved(start + (i * Math.PI * 2) / count, 10 / radius, 0, 0),
    );
  }
  if (radius === 244) {
    const overlap = 15 + random() * 5;
    return [
      curved(start, ((180 + overlap) * Math.PI) / 180, 0, overlap),
      curved(start + Math.PI, ((180 + overlap) * Math.PI) / 180, 1, overlap),
    ];
  }
  const overlap = small ? 20 + random() * 40 : 15 + random() * 20;
  return [curved(start, ((360 + overlap) * Math.PI) / 180, 0, overlap)];
}

export function ballpointPen(seed: string): Pen {
  const random = seededRandom(seed);
  const signed = (a: number): number => (random() * 2 - 1) * a;
  let serial = 0;
  const next = (shape: GestureShape): readonly BallpointGesture[] =>
    ballpointGesture(`${seed}:${serial++}`, shape);
  const pathData = (points: readonly Point[]): string => {
    const rounded = points.map(([x, y]): Point => [n(x), n(y)]);
    return (
      `M${rounded[0][0]} ${rounded[0][1]}` +
      rounded
        .slice(1)
        .map(([x, y], i) => `l${n(x - rounded[i][0])} ${n(y - rounded[i][1])}`)
        .join('')
    );
  };
  const draw = (gestures: readonly BallpointGesture[]): string =>
    gestures
      .map((gesture) => {
        const { points, widths, opacities, grooveOpacities } = gesture;
        let markup = '';
        // Six density/pressure zones retain continuous centerlines. Width is geometric ink,
        // not a parent opacity, so guide opacity still applies independently.
        const zones = Math.min(
          points.length > 20 ? 6 : points.length > 5 ? 3 : 2,
          points.length - 1,
        );
        for (let zone = 0; zone < zones; zone++) {
          const first = Math.floor((zone * (points.length - 1)) / zones);
          const last = Math.floor(((zone + 1) * (points.length - 1)) / zones);
          const middle = Math.floor((first + last) / 2);
          const skip = points.length > 20 && zone === 3 && random() < INK_SKIP_CHANCE;
          const local = points.slice(first, last + 1);
          if (skip && local.length > 1) {
            const [a, b] = local;
            const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
            local[0] = [
              a[0] + ((b[0] - a[0]) * 1.5) / length,
              a[1] + ((b[1] - a[1]) * 1.5) / length,
            ];
          }
          markup += `<path d="${pathData(local)}" stroke-width="${widths[middle]}" stroke-opacity="${opacities[middle]}"/>`;
        }
        // A fine, intermittent second ink edge from the ball's groove.
        const groove = points.map((point, i): Point => {
          const a = points[Math.max(0, i - 1)],
            b = points[Math.min(points.length - 1, i + 1)];
          const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
          return [
            point[0] - ((b[1] - a[1]) / length) * 0.6,
            point[1] + ((b[0] - a[0]) / length) * 0.6,
          ];
        });
        const grooveZones = points.length > 60 ? 3 : 1;
        const gestureLength = points
          .slice(1)
          .reduce(
            (length, point, i) =>
              length + Math.hypot(point[0] - points[i][0], point[1] - points[i][1]),
            0,
          );
        const grooveBreak =
          grooveZones === 1 && gestureLength > 20
            ? ` stroke-dasharray="${n(gestureLength * 0.4)} ${n(gestureLength * 0.12)}"`
            : '';
        for (let zone = 0; zone < grooveZones; zone++) {
          const first = Math.floor((zone * (points.length - 1)) / grooveZones),
            last = Math.floor(((zone + 1) * (points.length - 1)) / grooveZones);
          markup += `<path d="${pathData(groove.slice(first, last + 1).filter((_, i, values) => values.length <= 10 || i % 2 === 0 || i === values.length - 1))}" stroke-width="${n((BALLPOINT_WIDTH / DRAWING_SCALE) * 0.35)}" stroke-opacity="${grooveOpacities[Math.floor((first + last) / 2)]}"${grooveBreak}/>`;
        }
        if (gesture.blot)
          markup += `<circle cx="${points[0][0]}" cy="${points[0][1]}" r="${n(widths[0] * 0.67)}" fill="currentColor" stroke="none" fill-opacity="${INK_OPACITY}"/>`;
        return markup;
      })
      .join('')
      .replace(/([MLl \"=])(-?)0\./g, '$1$2.');
  const segment = (from: Point, to: Point, corner = false): string =>
    draw(next({ kind: 'line', from, to, corner }));
  const circle = (center: Point, radius: number, extra = ''): string =>
    draw(next({ kind: 'circle', center, radius, dashed: extra.includes('stroke-dasharray') }));
  const dot = (at: Point): string =>
    `<circle cx="${at[0]}" cy="${at[1]}" r="${n(BALLPOINT_WIDTH / DRAWING_SCALE / 2)}" fill="currentColor" stroke="none" fill-opacity="${INK_OPACITY}"/>`;
  const arc = (from: Point, to: Point, radius: number, large: 0 | 1, sweep: 0 | 1): string => {
    const dx = to[0] - from[0],
      dy = to[1] - from[1],
      chord = Math.hypot(dx, dy);
    if (!chord) return circle(from, radius);
    const r = Math.max(radius, chord / 2),
      h = Math.sqrt(Math.max(0, r * r - (chord * chord) / 4));
    const sign = large === sweep ? -1 : 1;
    const center: Point = [
      (from[0] + to[0]) / 2 - (sign * dy * h) / chord,
      (from[1] + to[1]) / 2 + (sign * dx * h) / chord,
    ];
    const start = Math.atan2(from[1] - center[1], from[0] - center[0]);
    let extent = Math.atan2(to[1] - center[1], to[0] - center[0]) - start;
    if (sweep && extent < 0) extent += Math.PI * 2;
    if (!sweep && extent > 0) extent -= Math.PI * 2;
    return draw(next({ kind: 'arc', center, radius: r, start, sweep: extent }));
  };
  const path = (commands: readonly PenCommand[], transform?: string): string => {
    let at: Point = [0, 0],
      start = at;
    const closed = commands.some((command) => command.op === 'Z');
    let markup = '';
    for (const command of commands) {
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
          if (Math.hypot(at[0] - start[0], at[1] - start[1]) > 0.1)
            markup += segment(at, start, true);
          break;
        case 'dot':
          markup += dot(at);
          break;
      }
    }
    if (!transform) return markup;
    // Ritual diamonds use world coordinates: vary about the mark, not the SVG origin.
    const pivot = transform.match(/^rotate\([-\d.]+ ([-\d.]+) ([-\d.]+)\)$/);
    const before = pivot ? `translate(${pivot[1]} ${pivot[2]}) ` : '';
    const after = pivot ? ` translate(${-Number(pivot[1])} ${-Number(pivot[2])})` : '';
    return `<g transform="${transform} translate(${n(signed(0.6))} ${n(signed(0.6))}) ${before}rotate(${n(signed(6))}) scale(${n(1 + signed(0.08))})${after}">${markup}</g>`;
  };
  return {
    path,
    line: (from, to) => segment(from, to),
    polyline: (points, transform) => path(commandsFor(points), transform),
    polygon: (points, transform) => path([...commandsFor(points), { op: 'Z' }], transform),
    circle,
    arc,
    dot,
    glyph: (d, transform, [x, y]) =>
      `<g transform="translate(${n(signed(0.35))} ${n(signed(0.35))}) rotate(${n(signed(2.5))} ${x} ${y}) translate(${x} ${y}) scale(${n(1 + signed(0.015))}) translate(${-x} ${-y})" fill-opacity="${INK_OPACITY}">${cleanPen.glyph(d, transform, [x, y])}</g>`,
  };
}
