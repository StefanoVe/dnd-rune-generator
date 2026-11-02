import { damageColorNames, damageColors, variableGradientStops } from './damage-colors';
import {
  areaOptions,
  castingTimeOptions,
  damageOptions,
  rangeOptions,
  schoolOptions,
  type AreaShape,
  type CastingTimeKind,
  type RuneComposition,
  type RuneExplanation,
  type RuneLayer,
  type RuneRenderOptions,
  type RuneStroke,
  type SpellRuneParams,
} from './rune-types';
import { schoolGlyphs } from './school-glyphs';

/*
 * Concentric rune, read from the centre outwards:
 *   core         school glyph, closed by the core ring
 *   level figure cantrip none, level 1 circle, level 2 oblique cut, level n polygon with n sides
 *   area         geometric figure inscribed across the rings
 *   range        eight spokes whose length/ending encodes the range
 *   script band  a bare ring of 16 casting-time glyphs (gaps where spokes pass)
 *   instances    the school glyph is repeated once per instance inside the core
 *   seal         closing outer ring; outside it, concentration eyes on the diagonals and
 *                ritual diamonds on the cardinal points
 * Every line uses the same stroke width; the colour of the whole rune is the damage type.
 */
const SIZE = 512;
const C = SIZE / 2;
export const RUNE_STROKE_WIDTH = 4;

export const CORE_RADIUS = 76;
const GLYPH_SIZE = 102;
const AREA_RADIUS = 192;
const BAND_INNER = 210;
const BAND_OUTER = 236;
const BAND_MID = (BAND_INNER + BAND_OUTER) / 2;
export const SCRIPT_SLOTS = 16;
const SEAL_RADIUS = 244;
/** Concentration and ritual marks hang outside the seal, on this radius. */
const OUTER_MARK_RADIUS = 268;
/**
 * The whole drawing is scaled down so the marks outside the seal still fit the 512 viewBox.
 * The stroke width is compensated, so every line is still exactly RUNE_STROKE_WIDTH on screen.
 */
export const RUNE_SCALE = 0.875;

const n = (value: number): number => Math.round(value * 100) / 100;

function polar(radius: number, degrees: number): readonly [number, number] {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return [n(C + radius * Math.cos(radians)), n(C + radius * Math.sin(radians))];
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}

function labelFor<T extends string>(
  options: readonly { readonly value: T; readonly label: string }[],
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

export function normalizeRuneParams(params: SpellRuneParams): SpellRuneParams {
  return {
    level: clampInteger(params.level, 0, 9),
    school: params.school,
    castingTime: {
      kind: params.castingTime.kind,
    },
    instances: clampInteger(params.instances, 1, MAX_INSTANCES),
    instancesInferred: Boolean(params.instancesInferred),
    range: {
      kind: params.range.kind,
      distanceFeet:
        params.range.kind === 'distance'
          ? clampInteger(params.range.distanceFeet ?? 0, 0, 9_999_999)
          : null,
    },
    area: {
      shape: params.area.shape,
      sizeFeet:
        params.area.shape === 'none' ? null : clampInteger(params.area.sizeFeet ?? 0, 0, 9999),
      inferred: params.area.inferred,
    },
    damageType: params.damageType,
    concentration: Boolean(params.concentration),
    ritual: Boolean(params.ritual),
  };
}

// ---------------------------------------------------------------------------
// Primitives

const circle = (radius: number, extra = ''): string =>
  `<circle cx="${C}" cy="${C}" r="${radius}"${extra}/>`;

const line = (from: readonly [number, number], to: readonly [number, number]): string =>
  `M${from[0]} ${from[1]}L${to[0]} ${to[1]}`;

/** A round-capped zero-length segment renders as a dot exactly one stroke wide. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const dot = (at: readonly [number, number]): string => `M${at[0]} ${at[1]}h0`;

const path = (d: string): string => `<path d="${d}"/>`;

function polygon(sides: number, radius: number, rotation = 0, step = 1): string {
  const points = Array.from({ length: sides }, (_, index) =>
    polar(radius, rotation + (index * step * 360) / sides),
  );
  return `M${points.map(([x, y]) => `${x} ${y}`).join('L')}Z`;
}

// ---------------------------------------------------------------------------
// Layers

export const MAX_INSTANCES = 12;

/** Room left for glyphs inside the core ring, and the gap between copies. */
const CORE_INNER = CORE_RADIUS - RUNE_STROKE_WIDTH;
const COPY_GAP = 6;

/**
 * Where the school glyph copies go: one big glyph for a single instance; for k copies, a
 * ring of k glyphs whose bounding circles (diameter `size`) fit the core without touching.
 */
export function glyphPlacements(
  instances: number,
): readonly { readonly x: number; readonly y: number; readonly size: number }[] {
  const k = clampInteger(instances, 1, MAX_INSTANCES);
  if (k === 1) return [{ x: C, y: C, size: 0 }];
  // Copies sit on radius r with bounding diameter s: s/2 + r = CORE_INNER and the chord
  // between neighbours 2r·sin(π/k) = s + COPY_GAP.
  const chord = 2 * Math.sin(Math.PI / k);
  const size = (chord * CORE_INNER - COPY_GAP) / (1 + chord / 2);
  const radius = CORE_INNER - size / 2;
  const offset = k === 2 ? 90 : 0;
  return Array.from({ length: k }, (_, i) => {
    const [x, y] = polar(radius, offset + (i * 360) / k);
    return { x, y, size: n(size) };
  });
}

/** The school glyph as a filled path centred on (x, y), scaled by `scale`. */
function schoolGlyphAt(params: SpellRuneParams, x: number, y: number, scale: number): string {
  const glyph = schoolGlyphs[params.school];
  const dx = n(x - scale * (glyph.x + glyph.width / 2));
  const dy = n(y - scale * (glyph.y + glyph.height / 2));
  return `<path d="${glyph.d}" fill="currentColor" stroke="none" transform="translate(${dx} ${dy}) scale(${n(scale * 10000) / 10000})"/>`;
}

function schoolMarkup(params: SpellRuneParams): string {
  const glyph = schoolGlyphs[params.school];
  const copies = glyphPlacements(params.instances).map(({ x, y, size }) => {
    // A single glyph is sized by its longest side; copies by their diagonal so they never overlap.
    const scale =
      size === 0
        ? GLYPH_SIZE / Math.max(glyph.width, glyph.height)
        : size / Math.hypot(glyph.width, glyph.height);
    return schoolGlyphAt(params, x, y, scale);
  });
  // Nothing but the glyph(s) in the middle: no enclosing ring.
  return copies.join('');
}

/** Circumradius of the level figure. Large enough that even the triangle clears the core. */
export const LEVEL_RADIUS = 168;

/**
 * Level figure: cantrip = nothing, level 1 = circle, level 2 = an oblique line cutting the
 * rune, level n ≥ 3 = regular n-gon (3 → triangle … 9 → nonagon), drawn with a flat edge on
 * top so it never reads as an area figure (those point a vertex upwards).
 * Returns the number of sides: 0 for no figure or the circle, 2 for the line.
 */
export function levelSides(level: number): number {
  const value = clampInteger(level, 0, 9);
  return value <= 1 ? 0 : value;
}

/** Direction of the level-2 cut (top-right to bottom-left). */
const LEVEL_CUT_ANGLE = 45;

const levelRotation = (sides: number): number => 180 / sides;

function levelMarkup(params: SpellRuneParams): string {
  if (params.level === 0) return '';
  const sides = levelSides(params.level);
  if (sides === 0) return circle(LEVEL_RADIUS);
  if (sides === 2) {
    // The cut crosses the whole rune up to the script band, but stops at the core ring so the
    // school glyph stays clear.
    return path(
      [LEVEL_CUT_ANGLE, LEVEL_CUT_ANGLE + 180]
        .map((angle) => line(polar(CORE_RADIUS, angle), polar(BAND_INNER, angle)))
        .join(''),
    );
  }
  return levelEdgesMarkup(params.level) + levelNodesMarkup(params) + innerBandMarkup(params);
}

/*
 * Higher levels are harder to draw, in tiers:
 *   4+  a node (small ring) on every vertex of the level polygon
 *   6+  the star {n/2} through the polygon's vertices
 *   7+  each node holds a mini school glyph, and an inner, inward-facing script band
 * Everything here is derived from the level: no new information, just more ink.
 */
export const NODE_MIN_LEVEL = 4;
export const STAR_MIN_LEVEL = 6;
export const INNER_BAND_MIN_LEVEL = 7;
const NODE_RADIUS = 9;
const GLYPH_NODE_RADIUS = 18;
const INNER_BAND_RADIUS = 92;
export const INNER_BAND_SLOTS = 12;

export function levelVertices(level: number): readonly (readonly [number, number])[] {
  const sides = levelSides(level);
  if (sides < 3) return [];
  return Array.from({ length: sides }, (_, i) =>
    polar(LEVEL_RADIUS, levelRotation(sides) + (i * 360) / sides),
  );
}

export function levelNodeRadius(level: number): number {
  return level >= INNER_BAND_MIN_LEVEL
    ? GLYPH_NODE_RADIUS
    : level >= NODE_MIN_LEVEL
      ? NODE_RADIUS
      : 0;
}

/**
 * Polygon edges (vertex i → i + 1) and, from STAR_MIN_LEVEL, star edges (vertex i → i + 2;
 * for even n these form two interlaced n/2-gons). With vertex nodes, every edge stops at the
 * node's rim so the nodes stay clean. Star edges stay clear of the core.
 */
export function levelEdges(
  level: number,
): readonly (readonly [readonly [number, number], readonly [number, number]])[] {
  const vertices = levelVertices(level);
  const sides = vertices.length;
  if (sides === 0) return [];
  const steps = level >= STAR_MIN_LEVEL ? [1, 2] : [1];
  const trim = levelNodeRadius(level);
  return steps.flatMap((step) =>
    vertices.map((a, i) => {
      const b = vertices[(i + step) % sides];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const [ux, uy] = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
      return [
        [n(a[0] + ux * trim), n(a[1] + uy * trim)],
        [n(b[0] - ux * trim), n(b[1] - uy * trim)],
      ] as const;
    }),
  );
}

function levelEdgesMarkup(level: number): string {
  const edges = levelEdges(level);
  // Without nodes the polygon is drawn as one closed path for clean corner joins.
  if (levelNodeRadius(level) === 0) {
    const sides = levelSides(level);
    return path(polygon(sides, LEVEL_RADIUS, levelRotation(sides)));
  }
  return path(edges.map(([a, b]) => line(a, b)).join(''));
}

function levelNodesMarkup(params: SpellRuneParams): string {
  const radius = levelNodeRadius(params.level);
  if (radius === 0) return '';
  const glyph = schoolGlyphs[params.school];
  const glyphScale = ((radius - 4) * 2) / Math.hypot(glyph.width, glyph.height);
  return levelVertices(params.level)
    .map(
      ([x, y]) =>
        `<circle cx="${x}" cy="${y}" r="${radius}"/>` +
        (params.level >= INNER_BAND_MIN_LEVEL ? schoolGlyphAt(params, x, y, glyphScale) : ''),
    )
    .join('');
}

/** Inner script band: the casting glyph again, facing inwards, between core and star. */
function innerBandMarkup(params: SpellRuneParams): string {
  if (params.level < INNER_BAND_MIN_LEVEL) return '';
  const glyph = castingGlyphs[params.castingTime.kind];
  return Array.from({ length: INNER_BAND_SLOTS }, (_, i) => {
    const angle = (i + 0.5) * (360 / INNER_BAND_SLOTS);
    const [x, y] = polar(INNER_BAND_RADIUS, angle);
    return `<path d="${glyph}" transform="translate(${x} ${y}) rotate(${n(angle + 180)})"/>`;
  }).join('');
}

/** Where a radial spoke starts: on the outline, or just outside a vertex node it would hit. */
function spokeStartRadius(level: number, angle: number): number {
  const outline = levelOutlineRadius(level, angle);
  const node = levelNodeRadius(level);
  if (node === 0) return outline;
  const [x, y] = polar(outline, angle);
  const hit = levelVertices(level).some(([vx, vy]) => Math.hypot(vx - x, vy - y) < node + 2);
  return hit ? n(LEVEL_RADIUS + node) : outline;
}

/** Distance from the centre to the level figure's outline in a given direction. */
export function levelOutlineRadius(level: number, degrees: number): number {
  if (clampInteger(level, 0, 9) === 0) return CORE_RADIUS;
  const sides = levelSides(level);
  if (sides === 0) return LEVEL_RADIUS;
  if (sides === 2) return CORE_RADIUS; // spokes leave the core, beside the cut
  const sector = 360 / sides;
  const local = (((degrees - levelRotation(sides)) % sector) + sector) % sector;
  const apothem = LEVEL_RADIUS * Math.cos(Math.PI / sides);
  return n(apothem / Math.cos(((local - sector / 2) * Math.PI) / 180));
}

function areaMarkup(shape: AreaShape, level: number): string {
  const R = AREA_RADIUS;
  switch (shape) {
    case 'none':
      return '';
    case 'sphere':
      // Vertex nodes and self-range rings need their own space before the script glyphs.
      return circle(levelNodeRadius(level) > 0 ? 206 : R, ' stroke-dasharray="10 9"');
    case 'cone':
      return path(polygon(3, R));
    case 'cube':
      return path(polygon(4, R));
    case 'square':
      return path(polygon(4, R, 45));
    case 'cylinder': {
      const inner = levelNodeRadius(level) > 0 ? 197 : R - 14;
      const outer = levelNodeRadius(level) > 0 ? 207 : R;
      const ties = Array.from({ length: 12 }, (_, i) =>
        line(polar(inner, i * 30), polar(outer, i * 30)),
      );
      return circle(inner) + circle(outer) + path(ties.join(''));
    }
    case 'line': {
      const inner = CORE_RADIUS + 12;
      return path(
        [90, 270]
          .map((angle) => {
            const capA = polar(R, angle - 4);
            const capB = polar(R, angle + 4);
            return line(polar(inner, angle), polar(R, angle)) + line(capA, capB);
          })
          .join(''),
      );
    }
    case 'emanation':
      return path(
        Array.from({ length: 16 }, (_, i) =>
          line(polar(R - 22, i * 22.5), polar(R, i * 22.5)),
        ).join(''),
      );
    case 'custom':
      return path(polygon(6, R, 0, 2) + polygon(6, R, 30, 2));
  }
}

/** 5 ft → 0, one mile (5280 ft) and beyond → 1, on a logarithmic scale. */
export function distanceScale(feet: number): number {
  if (feet <= 5) return 0;
  return Math.min(1, Math.log(feet / 5) / Math.log(5280 / 5));
}

/** How far a self-range bead sits from the figure it belongs to. */
const SELF_BEAD_OFFSET = 9;

/** Last radius a spoke may reach without touching the script band. */
const SPOKE_LIMIT = BAND_INNER - 6;

/** How far towards the script band the spokes reach (0 = at the start ring, 1 = at the band). */
export function spokeReach(params: SpellRuneParams): number {
  switch (params.range.kind) {
    case 'self':
      return 0;
    case 'touch':
      return 0.15;
    case 'distance':
      return n(0.3 + 0.7 * distanceScale(params.range.distanceFeet ?? 0));
    case 'sight':
    case 'unlimited':
      return 1;
    case 'special':
      return 0.6;
  }
}

/** Area size buckets (ft, upper bound inclusive) → number of range spokes. */
const SIZE_SPOKES: readonly (readonly [number, number])[] = [
  [5, 6],
  [10, 8],
  [15, 10],
  [20, 12],
  [30, 14],
  [60, 16],
  [Infinity, 18],
];
const BASE_SPOKES = 4;

/** The area size sets how many range spokes there are: 4 without an area, up to 18. */
export function spokeCount(params: SpellRuneParams): number {
  const size = params.area.shape === 'none' ? 0 : (params.area.sizeFeet ?? 0);
  if (size <= 0) return BASE_SPOKES;
  return SIZE_SPOKES.find(([limit]) => size <= limit)![1];
}

type Point = readonly [number, number];

/** One range spoke: it starts on the figure it hangs from and points along `to - from`. */
export interface RangeSpoke {
  readonly from: Point;
  readonly to: Point;
}

/** Spoke angles for radial spokes, offset by half a step. */
export function spokeAngles(params: SpellRuneParams): readonly number[] {
  const count = spokeCount(params);
  const step = 360 / count;
  return Array.from({ length: count }, (_, i) => n(step / 2 + i * step));
}

/** Fraction of the available room a spoke uses; sight and unlimited always use all of it. */
function spokeFraction(params: SpellRuneParams): number {
  const kind = params.range.kind;
  return kind === 'sight' || kind === 'unlimited' ? 1 : spokeReach(params);
}

/** Radius a spoke tip may reach. */
function spokeTarget(params: SpellRuneParams): number {
  const kind = params.range.kind;
  return kind === 'unlimited' ? SEAL_RADIUS : kind === 'sight' ? SPOKE_LIMIT - 10 : SPOKE_LIMIT;
}

/**
 * Where the range spokes are. They always hang from something drawn:
 *  - level 0 (no figure): from the outer seal, pointing inwards;
 *  - level 2 (the cut): perpendicular to the cut, in pairs along it, like a comb;
 *  - otherwise: radially outwards from the level figure's outline.
 * For a `self` range the spokes have no length (drawn as dots).
 */
export function rangeSpokes(params: SpellRuneParams): readonly RangeSpoke[] {
  const self = params.range.kind === 'self';
  const fraction = self ? 0 : spokeFraction(params);
  const count = spokeCount(params);

  if (self && params.level === 0) {
    // No figure to sit next to: thread the beads on the outer seal.
    return spokeAngles(params).map((angle) => {
      const point = polar(SEAL_RADIUS, angle);
      return { from: point, to: point };
    });
  }

  if (params.level === 2) {
    const pairs = count / 2;
    const inner = CORE_RADIUS + 10;
    const outer = LEVEL_RADIUS;
    const target = spokeTarget(params) - 6;
    const spokes: RangeSpoke[] = [];
    // Alternate the pairs between the two halves of the cut, outward from the centre.
    for (let i = 0; i < pairs; i++) {
      const half = i % 2 === 0 ? LEVEL_CUT_ANGLE : LEVEL_CUT_ANGLE + 180;
      const slot = Math.floor(i / 2);
      const slots = Math.ceil(pairs / 2);
      const d = slots === 1 ? (inner + outer) / 2 : inner + ((outer - inner) * slot) / (slots - 1);
      const base = polar(d, half);
      const room = Math.sqrt(Math.max(0, target * target - d * d));
      // Self range: a bead just beside the cut instead of a spoke.
      const length = self ? SELF_BEAD_OFFSET : n(8 + fraction * (room - 8));
      for (const side of [90, -90]) {
        const [dx, dy] = [polar(1, half + side)[0] - C, polar(1, half + side)[1] - C];
        spokes.push({ from: base, to: [n(base[0] + dx * length), n(base[1] + dy * length)] });
      }
    }
    return spokes;
  }

  return spokeAngles(params).map((angle) => {
    if (params.level === 0) {
      const from = SEAL_RADIUS;
      const room = SEAL_RADIUS - (CORE_RADIUS + 6);
      return { from: polar(from, angle), to: polar(n(from - fraction * room), angle) };
    }
    const from = spokeStartRadius(params.level, angle);
    const to = self
      ? n(from + SELF_BEAD_OFFSET) // a bead hugging the level figure
      : n(from + fraction * (spokeTarget(params) - from));
    return { from: polar(from, angle), to: polar(to, angle) };
  });
}

function rangeMarkup(params: SpellRuneParams): string {
  const kind = params.range.kind;
  const spokes = rangeSpokes(params);
  if (kind === 'self') {
    // No reach: the count (area size) stays readable as small rings on the anchor.
    return spokes.map(({ to }) => `<circle cx="${to[0]}" cy="${to[1]}" r="3"/>`).join('');
  }
  const parts: string[] = [];
  const tips: string[] = [];
  for (const { from, to } of spokes) {
    parts.push(line(from, to));
    const length = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1;
    const [ux, uy] = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
    const [px, py] = [-uy, ux];
    if (kind === 'touch' || kind === 'distance') {
      parts.push(
        line([n(to[0] + px * 6), n(to[1] + py * 6)], [n(to[0] - px * 6), n(to[1] - py * 6)]),
      );
    }
    if (kind === 'special') {
      parts.push(line(to, [n(to[0] - ux * 8 + px * 6), n(to[1] - uy * 8 + py * 6)]));
    }
    if (kind === 'sight') {
      tips.push(`<circle cx="${n(to[0] + ux * 5)}" cy="${n(to[1] + uy * 5)}" r="5"/>`);
    }
  }
  return path(parts.join('')) + tips.join('');
}

/** Casting-time glyphs in a local 16×16 box centred on the origin, upright = pointing outwards. */
const castingGlyphs: Readonly<Record<CastingTimeKind, string>> = {
  action: 'M0 -7L0 7',
  'bonus-action': 'M-6 6L0 -6L6 6',
  reaction: 'M-5 -7L5 -2L-5 2L5 7',
  minute: 'M0 -6A6 6 0 1 1 -0.01 -6Z',
  hour: 'M-6 -7L6 -7L-6 7L6 7Z',
  special: 'M0 -7L0 7M-6 -3.5L6 3.5M-6 3.5L6 -3.5',
};

/** Angles where a range spoke crosses the script band (level-0 spokes, unlimited range). */
function spokesCrossingBand(params: SpellRuneParams): readonly number[] {
  if (params.range.kind === 'self' || params.level === 2) return [];
  if (params.level === 0 || params.range.kind === 'unlimited') return spokeAngles(params);
  return [];
}

/** Script band: a bare ring of casting-time glyphs, with a gap wherever a spoke passes. */
export function castingGlyphAngles(params: SpellRuneParams): readonly number[] {
  const blocked = spokesCrossingBand(params);
  const clearance = 4; // degrees: about half a glyph plus a stroke at the band's radius
  return Array.from({ length: SCRIPT_SLOTS }, (_, i) => (i * 360) / SCRIPT_SLOTS).filter((angle) =>
    blocked.every((spoke) => {
      const distance = Math.abs(((angle - spoke + 540) % 360) - 180);
      return distance >= clearance;
    }),
  );
}

function castingMarkup(params: SpellRuneParams): string {
  const glyph = castingGlyphs[params.castingTime.kind];
  return castingGlyphAngles(params)
    .map((angle) => {
      const [x, y] = polar(BAND_MID, angle);
      return `<path d="${glyph}" transform="translate(${x} ${y}) rotate(${n(angle)})"/>`;
    })
    .join('');
}

function sealMarkup(): string {
  return circle(SEAL_RADIUS);
}

/** A short tie from the seal to an outer mark centred on OUTER_MARK_RADIUS. */
function tie(angle: number, markInner: number): string {
  return line(polar(SEAL_RADIUS, angle), polar(OUTER_MARK_RADIUS - markInner, angle));
}

/** Ritual: a diamond on each cardinal point, outside the seal. */
function ritualMarkup(): string {
  return [0, 90, 180, 270]
    .map((angle) => {
      const [x, y] = polar(OUTER_MARK_RADIUS, angle);
      return (
        path(tie(angle, 10)) +
        `<path d="M${x} ${n(y - 10)}L${n(x + 7)} ${y}L${x} ${n(y + 10)}L${n(x - 7)} ${y}Z" transform="rotate(${angle} ${x} ${y})"/>`
      );
    })
    .join('');
}

/** Concentration: an "eye of focus" (circle with a pupil) on each diagonal, outside the seal. */
function concentrationMarkup(): string {
  return [45, 135, 225, 315]
    .map((angle) => {
      const [x, y] = polar(OUTER_MARK_RADIUS, angle);
      return path(tie(angle, 8)) + `<circle cx="${x}" cy="${y}" r="8"/>` + path(`M${x} ${y}h0`);
    })
    .join('');
}

// ---------------------------------------------------------------------------
// Composition & rendering

export function runeColor(params: SpellRuneParams): string {
  return params.damageType === 'variable'
    ? 'url(#rune-variable-ink)'
    : damageColors[params.damageType];
}

export function composeRune(params: SpellRuneParams): RuneComposition {
  const value = normalizeRuneParams(params);
  const steps: [string, RuneLayer, string][] = [
    ['core', 'school', schoolMarkup(value)],
    ['level-rings', 'level', levelMarkup(value)],
    ['area-figure', 'area', areaMarkup(value.area.shape, value.level)],
    ['range-spokes', 'range', rangeMarkup(value)],
    ['script-band', 'casting-time', castingMarkup(value)],
    ['outer-seal', 'seal', sealMarkup()],
  ];
  if (value.concentration)
    steps.push(['concentration-marks', 'concentration', concentrationMarkup()]);
  if (value.ritual) steps.push(['ritual-marks', 'ritual', ritualMarkup()]);
  const strokes: RuneStroke[] = steps
    .filter(([, , markup]) => markup.length > 0)
    .map(([id, layer, markup], index) => ({ id, layer, markup, order: index + 1 }));
  return { params: value, color: runeColor(value), strokes };
}

function escapeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function gradientDefs(): string {
  const stops = variableGradientStops
    .map(
      (color, index) =>
        `<stop offset="${n(index / (variableGradientStops.length - 1))}" stop-color="${color}"/>`,
    )
    .join('');
  return `<defs><linearGradient id="rune-variable-ink" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${SIZE}" y2="${SIZE}">${stops}</linearGradient></defs>`;
}

export function renderRuneSvg(
  compositionOrParams: RuneComposition | SpellRuneParams,
  options: RuneRenderOptions = {},
): string {
  const composition =
    'strokes' in compositionOrParams ? compositionOrParams : composeRune(compositionOrParams);
  const visible = composition.strokes.slice(
    0,
    Math.max(0, options.visibleStrokeCount ?? composition.strokes.length),
  );
  const groups = visible
    .map((stroke, index) => {
      const opacity =
        options.currentStroke !== undefined
          ? index < options.currentStroke
            ? 0.3
            : index === options.currentStroke
              ? 1
              : 0.1
          : options.highlightedLayer && stroke.layer !== options.highlightedLayer
            ? 0.18
            : 1;
      const opacityAttribute = opacity === 1 ? '' : ` opacity="${opacity}"`;
      return `<g data-stroke-order="${stroke.order}" data-rune-layer="${stroke.layer}"${opacityAttribute}>${stroke.markup}</g>`;
    })
    .join('');
  const variable = composition.params.damageType === 'variable';
  const ink = composition.color;
  // `color` drives the filled school glyph (currentColor); a gradient can't be a color, so
  // variable damage also fills the glyph through the gradient explicitly.
  const glyphFill = variable ? groups.replace('fill="currentColor"', `fill="${ink}"`) : groups;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" role="img" aria-label="${escapeAttribute(runeSummary(composition.params))}" focusable="false">` +
    (variable ? gradientDefs() : '') +
    `<g fill="none" stroke="${ink}" color="${variable ? variableGradientStops[0] : ink}" stroke-width="${n(RUNE_STROKE_WIDTH / RUNE_SCALE)}" stroke-linecap="round" stroke-linejoin="round" transform="translate(${C} ${C}) scale(${RUNE_SCALE}) translate(${-C} ${-C})">${glyphFill}</g></svg>`
  );
}

// ---------------------------------------------------------------------------
// Explanation

function rangeText(params: SpellRuneParams): string {
  return params.range.kind === 'distance'
    ? `${params.range.distanceFeet} ft`
    : labelFor(rangeOptions, params.range.kind);
}

function castingText(params: SpellRuneParams): string {
  return labelFor(castingTimeOptions, params.castingTime.kind);
}

const areaDetails: Readonly<Record<AreaShape, string>> = {
  none: 'Nessuna figura inscritta.',
  sphere: 'Cerchio tratteggiato inscritto attorno alla figura di livello.',
  cone: 'Triangolo inscritto con la punta verso l’alto.',
  cube: 'Rombo inscritto (quadrato poggiato su un vertice).',
  square: 'Quadrato inscritto con i lati orizzontali.',
  cylinder: 'Due cerchi legati da dodici traversine.',
  line: 'Barra orizzontale ai due lati del nucleo, con terminali.',
  emanation: 'Sedici raggi corti che irradiano dal bordo dell’area.',
  custom: 'Esagramma inscritto (due triangoli intrecciati).',
};

const rangeDetails: Readonly<Record<SpellRuneParams['range']['kind'], string>> = {
  self: 'Nessun raggio: piccoli anelli accostati alla figura di livello (o al sigillo, per i trucchetti), tanti quanti sarebbero i raggi. La magia non lascia il lanciatore.',
  touch: 'Raggi cortissimi che partono dalla figura di livello, con una barretta in punta.',
  distance:
    'Raggi dalla figura di livello verso la fascia di scrittura, con barretta in punta: più si avvicinano alla fascia, più è lontano (scala logaritmica, da 5 ft a un miglio).',
  sight: 'Raggi che arrivano alla fascia di scrittura e terminano in un piccolo occhio circolare.',
  unlimited: 'Raggi che attraversano la fascia di scrittura fino al sigillo esterno.',
  special: 'Raggi con un uncino in punta.',
};

const castingDetails: Readonly<Record<CastingTimeKind, string>> = {
  action: 'Glifo a tratto verticale',
  'bonus-action': 'Glifo a punta di freccia',
  reaction: 'Glifo a zig-zag',
  minute: 'Glifo circolare',
  hour: 'Glifo a clessidra',
  special: 'Glifo a stella',
};

export function describeRune(params: SpellRuneParams): readonly RuneExplanation[] {
  const p = normalizeRuneParams(params);
  return [
    {
      layer: 'school',
      label: 'Nucleo',
      value:
        p.instances > 1
          ? `${labelFor(schoolOptions, p.school)} · ${p.instances} istanze`
          : labelFor(schoolOptions, p.school),
      detail:
        p.instances > 1
          ? `La runa della scuola è ripetuta ${p.instances} volte in cerchio: una copia per istanza (raggi, dardi o bersagli).`
          : 'Il simbolo al centro è la runa della scuola di magia; una sola copia = una sola istanza.',
    },
    {
      layer: 'level',
      label: 'Figura di livello',
      value: p.level === 0 ? 'Trucchetto' : `Livello ${p.level}`,
      detail:
        p.level === 0
          ? 'Nessuna figura attorno al nucleo.'
          : p.level === 1
            ? 'Un cerchio attorno al nucleo.'
            : p.level === 2
              ? 'Una linea obliqua che taglia la runa, interrotta solo dal nucleo.'
              : [
                  `Poligono regolare di ${p.level} lati (uno per livello) attorno al nucleo, con un lato in alto.`,
                  p.level >= NODE_MIN_LEVEL ? 'Un nodo circolare su ogni vertice.' : '',
                  p.level >= STAR_MIN_LEVEL
                    ? `Una stella {${p.level}/2} unisce i vertici a salti.`
                    : '',
                  p.level >= INNER_BAND_MIN_LEVEL
                    ? 'Ogni nodo contiene la runa della scuola e una seconda fascia di glifi, rivolta verso il centro, circonda il nucleo.'
                    : '',
                ]
                  .filter(Boolean)
                  .join(' '),
    },
    {
      layer: 'damage',
      label: 'Colore',
      value: labelFor(damageOptions, p.damageType),
      detail: `Tutta la runa è tracciata in ${damageColorNames[p.damageType]}.`,
    },
    {
      layer: 'area',
      label: 'Figura d’area',
      value:
        p.area.shape === 'none'
          ? 'Nessuna'
          : `${labelFor(areaOptions, p.area.shape)} · ${p.area.sizeFeet} ft`,
      detail: `${areaDetails[p.area.shape]} La misura decide quanti raggi di gittata ci sono: ${spokeCount(p)} (4 senza area, fino a 18 oltre i 60 ft).`,
    },
    {
      layer: 'range',
      label: 'Raggi di gittata',
      value: rangeText(p),
      detail: rangeDetails[p.range.kind],
    },
    {
      layer: 'casting-time',
      label: 'Fascia di scrittura',
      value: castingText(p),
      detail: `${castingDetails[p.castingTime.kind]} ripetuto in cerchio lungo la fascia esterna (si interrompe solo dove passa un raggio).`,
    },
    {
      layer: 'concentration',
      label: 'Occhi di concentrazione',
      value: p.concentration ? 'Concentrazione' : 'Senza concentrazione',
      detail: p.concentration
        ? 'Quattro cerchi con pupilla fuori dal sigillo, sulle diagonali, legati al sigillo da un breve tratto.'
        : 'Nessun segno sulle diagonali fuori dal sigillo.',
    },
    {
      layer: 'ritual',
      label: 'Rombi rituali',
      value: p.ritual ? 'Rituale' : 'Non rituale',
      detail: p.ritual
        ? 'Quattro rombi fuori dal sigillo, sui punti cardinali, legati al sigillo da un breve tratto.'
        : 'Nessun segno sui punti cardinali fuori dal sigillo.',
    },
  ];
}

export function runeSummary(params: SpellRuneParams): string {
  const p = normalizeRuneParams(params);
  const level = p.level === 0 ? 'trucchetto' : `livello ${p.level}`;
  return `Runa di ${level}, scuola ${labelFor(schoolOptions, p.school).toLocaleLowerCase('it')}, danno ${labelFor(damageOptions, p.damageType).toLocaleLowerCase('it')}, gittata ${rangeText(p)}, lancio ${castingText(p).toLocaleLowerCase('it')}${p.instances > 1 ? `, ${p.instances} istanze` : ''}${p.concentration ? ', concentrazione' : ''}${p.ritual ? ', rituale' : ''}.`;
}
