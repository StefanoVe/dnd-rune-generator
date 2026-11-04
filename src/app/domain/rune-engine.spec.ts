import { BALLPOINT_WIDTH, INK_OPACITY, MAX_WOBBLE, MAX_OVERSHOOT, circleWobble, GRAIN_DISPLACEMENT } from './pen';
import { spellCatalog } from '../catalog/spell-catalog';
import { contrastRatio, damageColors, paperColor, variableGradientStops } from './damage-colors';
import {
  glyphPlacements,
  MAX_INSTANCES,
  composeRune as composeStyledRune,
  describeRune,
  levelOutlineRadius,
  levelNodeRadius,
  levelSides,
  LEVEL_RADIUS,
  CORE_RADIUS,
  normalizeRuneParams,
  renderRuneSvg as renderStyledRuneSvg,
  RUNE_SCALE,
  rangeSpokes,
  levelVertices,
  levelEdges,
  castingGlyphAngles,
  spokeCount,
  RUNE_STROKE_WIDTH,
  runeSummary,
  SCRIPT_SLOTS,
} from './rune-engine';
import {
  areaOptions,
  castingTimeOptions,
  damageOptions,
  defaultRuneParams,
  rangeOptions,
  schoolOptions,
} from './rune-types';
import { schoolGlyphs } from './school-glyphs';

// Existing geometry regressions exercise the exact drafting pen.
const composeRune: typeof composeStyledRune = (params, options) =>
  composeStyledRune(params, { ...options, style: 'clean' });
const renderRuneSvg: typeof renderStyledRuneSvg = (params, options) =>
  renderStyledRuneSvg(params, { ...options, style: 'clean' });

describe('concentric rune engine', () => {
  it('renders identical SVG for identical and normalized parameters', () => {
    const params = {
      ...defaultRuneParams,
      level: 42,
      instances: 0,
    };
    expect(renderRuneSvg(params)).toBe(renderRuneSvg(params));
    expect(renderRuneSvg(params)).toBe(renderRuneSvg(normalizeRuneParams(params)));
  });

  it('uses distinct school paths whose transformed bounding boxes fit inside the core ring', () => {
    expect(new Set(Object.values(schoolGlyphs).map((glyph) => glyph.d)).size).toBe(
      schoolOptions.length,
    );
    for (const { value } of schoolOptions) {
      const core = composeRune({ ...defaultRuneParams, school: value }).strokes[0].markup;
      const document = new DOMParser().parseFromString('<svg>' + core + '</svg>', 'image/svg+xml');
      const glyph = schoolGlyphs[value];
      const path = document.querySelector('path')!;
      expect(path.getAttribute('d')).toBe(glyph.d);
      const match = path
        .getAttribute('transform')!
        .match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/)!;
      const [dx, dy, scale] = match.slice(1).map(Number);
      for (const x of [glyph.x, glyph.x + glyph.width]) {
        for (const y of [glyph.y, glyph.y + glyph.height]) {
          expect(Math.hypot(dx + scale * x - 256, dy + scale * y - 256), value).toBeLessThanOrEqual(
            CORE_RADIUS - RUNE_STROKE_WIDTH / 2,
          );
        }
      }
      expect(document.querySelector('circle')).toBeNull(); // nothing around the glyph
    }
  });

  it('draws nothing for cantrips, a circle for level 1, a cut for level 2, an n-gon from 3', () => {
    const levelMarkup = (level: number) =>
      composeRune({ ...defaultRuneParams, level }).strokes.find((step) => step.layer === 'level')
        ?.markup;
    expect(levelMarkup(0)).toBeUndefined();
    expect(levelMarkup(1)).toBe(`<circle cx="256" cy="256" r="${LEVEL_RADIUS}"/>`);
    const cut = levelMarkup(2)?.match(/d="([^"]+)"/)?.[1] ?? '';
    expect(levelSides(2)).toBe(2);
    expect(cut.match(/M/g)).toHaveLength(2);
    expect(cut).not.toContain('Z');
    const triangle = levelMarkup(3)?.match(/d="([^"]+)"/)?.[1] ?? '';
    expect(triangle.split('L')).toHaveLength(3);
    expect(triangle.endsWith('Z')).toBe(true);
    for (let level = 3; level <= 9; level++) {
      expect(levelSides(level)).toBe(level);
      expect(levelVertices(level)).toHaveLength(level);
    }
  });

  it('keeps every level figure clear of the core and starts spokes on its outline', () => {
    for (const level of [1, 3, 4, 5, 6, 7, 8, 9]) {
      for (let angle = 0; angle < 360; angle += 7.5) {
        const radius = levelOutlineRadius(level, angle);
        expect(radius).toBeGreaterThan(CORE_RADIUS + RUNE_STROKE_WIDTH);
        expect(radius).toBeLessThanOrEqual(LEVEL_RADIUS + 0.01);
      }
    }
    expect(levelOutlineRadius(0, 22.5)).toBe(CORE_RADIUS);
    expect(levelOutlineRadius(1, 22.5)).toBe(LEVEL_RADIUS);
    expect(levelOutlineRadius(2, 22.5)).toBe(CORE_RADIUS);
  });

  it('makes higher levels harder to draw in tiers, keeping everything clear of the core', () => {
    const level = (value: number) =>
      composeRune({ ...defaultRuneParams, level: value }).strokes.find((s) => s.layer === 'level')!
        .markup;
    const circles = (markup: string) => markup.match(/<circle /g)?.length ?? 0;
    const glyphs = (markup: string) => markup.match(/fill="currentColor"/g)?.length ?? 0;

    expect(circles(level(3))).toBe(0); // plain triangle
    expect(circles(level(4))).toBe(4); // nodes
    expect(circles(level(5))).toBe(5);
    expect(levelEdges(5)).toHaveLength(5); // no star yet
    expect(levelEdges(6)).toHaveLength(12); // hexagon + two triangles
    expect(levelEdges(9)).toHaveLength(18);
    expect(level(6).match(/rotate\(/g)).toBeNull(); // no inner band yet
    expect(level(7).match(/rotate\(/g)).toHaveLength(12); // inner band
    // Edges stop at the node rims: no edge endpoint is inside a node.
    for (const value of [4, 6, 9]) {
      const rim = value >= 7 ? 18 : 9;
      for (const [a, b] of levelEdges(value))
        for (const [vx, vy] of levelVertices(value))
          for (const [x, y] of [a, b])
            expect(Math.hypot(x - vx, y - vy)).toBeGreaterThan(rim - 0.1);
    }
    expect(glyphs(level(6))).toBe(0);
    for (const value of [7, 8, 9]) expect(glyphs(level(value))).toBe(value); // glyph per node

    // Star edges (vertices two apart) stay outside the core glyph.
    for (let value = 6; value <= 9; value++) {
      const v = levelVertices(value);
      const [a, b] = [v[0], v[2]];
      const distance =
        Math.abs((b[0] - a[0]) * (a[1] - 256) - (a[0] - 256) * (b[1] - a[1])) /
        Math.hypot(b[0] - a[0], b[1] - a[1]);
      expect(distance).toBeGreaterThan(CORE_RADIUS + RUNE_STROKE_WIDTH);
    }
  });

  it('keeps distinct damage inks and all gradient stops at 3:1 contrast against paper', () => {
    const colors = Object.values(damageColors);
    expect(new Set(colors).size).toBe(colors.length);
    for (const color of [...colors, ...variableGradientStops])
      expect(contrastRatio(color, paperColor), color).toBeGreaterThanOrEqual(3);
  });

  it('colors the whole rune by damage type and defines variable ink as a gradient', () => {
    for (const { value } of damageOptions) {
      const svg = renderRuneSvg({ ...defaultRuneParams, damageType: value });
      if (value === 'variable') {
        expect(svg).toContain('stroke="url(#rune-variable-ink)"');
        expect(svg).toContain('<linearGradient id="rune-variable-ink"');
        for (const stop of variableGradientStops)
          expect(svg).toContain('stop-color="' + stop + '"');
      } else expect(svg).toContain('stroke="' + damageColors[value] + '"');
    }
  });

  it('gives every area shape distinct markup and omits none', () => {
    const markups = areaOptions.map(
      ({ value }) =>
        composeRune({
          ...defaultRuneParams,
          area: { shape: value, sizeFeet: 20, inferred: false },
        }).strokes.find((step) => step.layer === 'area')?.markup,
    );
    expect(markups[0]).toBeUndefined();
    expect(new Set(markups.slice(1)).size).toBe(areaOptions.length - 1);
  });

  it('gives every range kind distinct markup, self as dots only', () => {
    const markups = rangeOptions.map(
      ({ value }) =>
        composeRune({
          ...defaultRuneParams,
          range: { kind: value, distanceFeet: value === 'distance' ? 60 : null },
        }).strokes.find((step) => step.layer === 'range')?.markup,
    );
    expect(markups[0]).not.toContain('L');
    expect(new Set(markups).size).toBe(rangeOptions.length);
  });

  it('adds range spokes as the area grows', () => {
    const withArea = (sizeFeet: number | null, shape: 'none' | 'sphere' = 'sphere') =>
      ({ ...defaultRuneParams, area: { shape, sizeFeet, inferred: false } }) as const;
    expect(spokeCount(withArea(null, 'none'))).toBe(4);
    const sizes = [5, 10, 15, 20, 30, 60, 100];
    expect(sizes.map((size) => spokeCount(withArea(size)))).toEqual([6, 8, 10, 12, 14, 16, 18]);
    for (const size of sizes) {
      const params = withArea(size);
      const range = composeRune(params).strokes.find((step) => step.layer === 'range')!.markup;
      expect(range.match(/M/g)!.length).toBe(spokeCount(params) * 2); // spoke + crossbar
    }
    const self = { ...withArea(20), range: { kind: 'self', distanceFeet: null } } as const;
    expect(
      composeRune(self)
        .strokes.find((step) => step.layer === 'range')!
        .markup.match(/r="3"/g),
    ).toHaveLength(12);
  });

  it('keeps self-range beads close to their own figure, clear of it and of the nodes', () => {
    const beads = (level: number) => {
      const params = {
        ...defaultRuneParams,
        level,
        range: { kind: 'self', distanceFeet: null },
        area: { shape: 'sphere', sizeFeet: 60, inferred: false },
      } as const;
      const markup = composeRune(params).strokes.find((step) => step.layer === 'range')!.markup;
      const circles = [
        ...new DOMParser()
          .parseFromString(`<svg>${markup}</svg>`, 'image/svg+xml')
          .querySelectorAll('circle'),
      ].map((c) => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))] as const);
      expect(circles).toHaveLength(spokeCount(params));
      return circles;
    };
    const radius = ([x, y]: readonly [number, number]) => Math.hypot(x - 256, y - 256);
    const angle = ([x, y]: readonly [number, number]) =>
      ((Math.atan2(y - 256, x - 256) * 180) / Math.PI + 90 + 360) % 360;

    // Cantrip: on the outer seal.
    for (const bead of beads(0)) expect(radius(bead)).toBeCloseTo(244, 0);

    // Level 2: beside the cut (the 45°–225° diagonal), within a dozen px of it.
    for (const [x, y] of beads(2)) {
      const distanceFromCut = Math.abs(x - 256 + (y - 256)) / Math.SQRT2;
      expect(distanceFromCut).toBeGreaterThan(5);
      expect(distanceFromCut).toBeLessThan(12);
    }

    // Circle and polygons: just outside the outline, never inside a vertex node.
    for (const level of [1, 3, 5, 9]) {
      for (const bead of beads(level)) {
        const gap = radius(bead) - levelOutlineRadius(level, angle(bead));
        expect(gap).toBeGreaterThan(5);
        expect(gap).toBeLessThan(2 * levelNodeRadius(level) + 14); // may step past a node
        for (const [vx, vy] of levelVertices(level))
          expect(Math.hypot(bead[0] - vx, bead[1] - vy)).toBeGreaterThan(
            levelNodeRadius(level) + 3,
          );
      }
    }
  });

  it('keeps high-level vertex nodes clear of sphere and cylinder circles', () => {
    for (const level of [7, 8, 9]) {
      for (const shape of ['sphere', 'cylinder'] as const) {
        const markup = composeRune({
          ...defaultRuneParams,
          level,
          area: { shape, sizeFeet: 60, inferred: false },
        }).strokes.find((step) => step.layer === 'area')!.markup;
        const circles = new DOMParser()
          .parseFromString(`<svg>${markup}</svg>`, 'image/svg+xml')
          .querySelectorAll('circle');
        expect(circles).toHaveLength(shape === 'sphere' ? 1 : 2);
        for (const [x, y] of levelVertices(level)) {
          const nodeDistance = Math.hypot(x - 256, y - 256);
          for (const circle of circles) {
            const areaRadius = Number(circle.getAttribute('r'));
            const clearance =
              Math.abs(areaRadius - nodeDistance) - levelNodeRadius(level) - RUNE_STROKE_WIDTH;
            expect(clearance).toBeGreaterThanOrEqual(6);
          }
        }
      }
    }
  });

  it('hangs spokes from the seal at level 0 and from the cut at level 2', () => {
    const params = {
      ...defaultRuneParams,
      area: { shape: 'sphere', sizeFeet: 20, inferred: false },
    } as const;
    const radius = ([x, y]: readonly [number, number]) => Math.hypot(x - 256, y - 256);

    const cantrip = rangeSpokes({ ...params, level: 0 });
    expect(cantrip).toHaveLength(12);
    for (const { from, to } of cantrip) {
      expect(radius(from)).toBeCloseTo(244, 0);
      expect(radius(to)).toBeLessThan(radius(from)); // pointing inwards
    }

    const cut = rangeSpokes({ ...params, level: 2 });
    expect(cut).toHaveLength(12);
    for (const { from, to } of cut) {
      // `from` lies on the 45°–225° diagonal (y - 256 = -(x - 256)) …
      expect(from[1] - 256).toBeCloseTo(-(from[0] - 256), 0);
      // … and the spoke is perpendicular to it.
      const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
      expect(Math.abs(dx - dy) / Math.hypot(dx, dy)).toBeLessThan(0.02);
      expect(radius(to)).toBeLessThanOrEqual(206);
    }
  });

  it('fills the whole script band with the casting-time glyph', () => {
    const markup = composeRune(defaultRuneParams).strokes.find(
      (step) => step.layer === 'casting-time',
    )!.markup;
    const root = new DOMParser().parseFromString(`<svg>${markup}</svg>`, 'image/svg+xml');
    const copies = [...root.querySelectorAll('path')];
    expect(copies).toHaveLength(SCRIPT_SLOTS);
    expect(new Set(copies.map((copy) => copy.getAttribute('d'))).size).toBe(1);
    expect(copies.every((copy) => copy.hasAttribute('transform'))).toBe(true);
    expect(markup).not.toContain('<circle');
    // At level 0 spokes cross the band: a glyph lying on a spoke is left out.
    const cantrip = {
      ...defaultRuneParams,
      level: 0,
      area: { shape: 'none', sizeFeet: null, inferred: false },
    } as const; // 4 spokes at 45°, 135°… exactly on glyph slots
    expect(castingGlyphAngles(cantrip)).toHaveLength(SCRIPT_SLOTS - 4);
    expect(castingGlyphAngles(cantrip)).not.toContain(45);
  });

  it('repeats the school glyph once per instance, capped, without overlaps or leaving the core', () => {
    const glyphCount = (instances: number) =>
      composeRune({ ...defaultRuneParams, instances }).strokes[0].markup.match(/<path /g)?.length;
    expect(glyphCount(1)).toBe(1);
    expect(glyphCount(3)).toBe(3);
    expect(glyphCount(99)).toBe(MAX_INSTANCES);
    for (let k = 2; k <= MAX_INSTANCES; k++) {
      const copies = glyphPlacements(k);
      expect(copies).toHaveLength(k);
      for (const [i, a] of copies.entries()) {
        expect(Math.hypot(a.x - 256, a.y - 256) + a.size / 2).toBeLessThanOrEqual(
          CORE_RADIUS - RUNE_STROKE_WIDTH / 2,
        );
        for (const b of copies.slice(i + 1))
          expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(a.size);
      }
    }
    const multi = { ...defaultRuneParams, instances: 3 };
    expect(describeRune(multi).find((item) => item.layer === 'school')?.detail).toContain(
      'ripetuta 3 volte',
    );
    expect(runeSummary(multi)).toContain('3 istanze');
  });

  it('marks concentration on the diagonals and ritual on the cardinals, outside the seal', () => {
    const step = (params: Partial<typeof defaultRuneParams>, layer: string) =>
      composeRune({ ...defaultRuneParams, ...params }).strokes.find((s) => s.layer === layer);
    expect(step({ concentration: false }, 'concentration')).toBeUndefined();
    expect(step({ ritual: false }, 'ritual')).toBeUndefined();
    expect(step({}, 'seal')!.markup.match(/<circle /g)).toHaveLength(1);

    const centres = (markup: string, pattern: RegExp) =>
      [...markup.matchAll(pattern)].map((m) => [Number(m[1]), Number(m[2])] as const);
    const angleOf = ([x, y]: readonly [number, number]) =>
      ((Math.atan2(y - 256, x - 256) * 180) / Math.PI + 90 + 360) % 360;

    const eyes = centres(
      step({ concentration: true }, 'concentration')!.markup,
      /<circle cx="([-\d.]+)" cy="([-\d.]+)"/g,
    );
    expect(eyes.map((c) => Math.round(angleOf(c)))).toEqual([45, 135, 225, 315]);

    const diamonds = centres(
      step({ ritual: true }, 'ritual')!.markup,
      /rotate\([-\d.]+ ([-\d.]+) ([-\d.]+)\)/g,
    );
    expect(diamonds.map((c) => Math.round(angleOf(c)))).toEqual([0, 90, 180, 270]);

    for (const c of [...eyes, ...diamonds])
      expect(Math.hypot(c[0] - 256, c[1] - 256)).toBeGreaterThan(244);
  });

  it('keeps the scaled drawing, outer marks included, inside the viewBox', () => {
    const outer = 268 + 10 + RUNE_STROKE_WIDTH / RUNE_SCALE / 2;
    expect(outer * RUNE_SCALE).toBeLessThanOrEqual(256);
  });

  it('uses one uniform stroke width and a text-free accessible SVG', () => {
    const svg = renderRuneSvg(defaultRuneParams);
    expect(svg.match(/stroke-width=/g)).toHaveLength(1);
    // Effective on-screen width is the attribute times the drawing scale.
    const width = Number(svg.match(/stroke-width="([\d.]+)"/)![1]);
    expect(width * RUNE_SCALE).toBeCloseTo(RUNE_STROKE_WIDTH, 1);
    expect(svg).not.toMatch(/<(text|title|desc)\b/i);
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    expect(root.getAttribute('role')).toBe('img');
    expect(root.getAttribute('aria-label')).toBe(runeSummary(defaultRuneParams));
    expect(root.querySelectorAll('[stroke-width]')).toHaveLength(1);
  });

  it('orders steps from core to ritual and renders exactly k visible groups', () => {
    const params = { ...defaultRuneParams, concentration: true, ritual: true };
    const composition = composeRune(params);
    expect(composition.strokes.map((step) => step.layer)).toEqual([
      'school',
      'level',
      'area',
      'range',
      'casting-time',
      'seal',
      'concentration',
      'ritual',
    ]);
    expect(composition.strokes.map((step) => step.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    for (let k = 0; k <= composition.strokes.length; k++)
      expect(
        renderRuneSvg(composition, { visibleStrokeCount: k }).match(/data-stroke-order=/g) ?? [],
      ).toHaveLength(k);
    expect(describeRune(params)).toHaveLength(8);
  });
});

describe('generated catalog', () => {
  it('contains 576 unique metadata-only spells with valid text-free runes', () => {
    expect(spellCatalog.spellCount).toBe(576);
    expect(new Set(spellCatalog.spells.map((spell) => spell.id)).size).toBe(576);
    expect(JSON.stringify(spellCatalog)).not.toContain('description');
    for (const spell of spellCatalog.spells) {
      const svg = renderRuneSvg(spell.rune);
      expect(
        new DOMParser().parseFromString(svg, 'image/svg+xml').querySelector('parsererror'),
        spell.id,
      ).toBeNull();
      expect(svg).not.toMatch(/<(text|title|desc)\b/i);
    }
  });
});

describe('ballpoint rune rendering', () => {
  it('is the default, normalized and byte-for-byte deterministic', () => {
    const params = { ...defaultRuneParams, level: 99, instances: 99 };
    expect(renderStyledRuneSvg(params)).toBe(renderStyledRuneSvg(normalizeRuneParams(params)));
    expect(renderStyledRuneSvg(params)).toBe(renderStyledRuneSvg(params, { style: 'ballpoint' }));
    expect(renderStyledRuneSvg(params)).not.toBe(renderStyledRuneSvg(params, { style: 'clean' }));
  });

  it('seeds each layer only with parameters affecting its geometry', () => {
    const params = { ...defaultRuneParams, level: 9, concentration: true, ritual: true };
    const original = composeStyledRune(params);
    const changes = [
      { params: { ...params, concentration: false }, affected: ['concentration'] },
      { params: { ...params, ritual: false }, affected: ['ritual'] },
      { params: { ...params, instances: 4 }, affected: ['school'] },
      { params: { ...params, school: 'illusion' as const }, affected: ['school', 'level'] },
      { params: { ...params, castingTime: { kind: 'hour' as const } }, affected: ['level', 'casting-time'] },
      { params: { ...params, damageType: 'variable' as const }, affected: [] },
      { params: { ...params, area: { ...params.area, sizeFeet: 60 } }, affected: ['range', 'casting-time'] },
      { params: { ...params, range: { kind: 'touch' as const, distanceFeet: null } }, affected: ['range'] },
    ];
    for (const change of changes) {
      const updated = composeStyledRune(change.params);
      for (const stroke of original.strokes.filter((stroke) => !change.affected.includes(stroke.layer))) {
        expect(updated.strokes.find((step) => step.layer === stroke.layer)?.markup).toBe(stroke.markup);
      }
    }
  });

  it('gives repeated casting glyphs distinct geometry and placement', () => {
    const markup = composeStyledRune(defaultRuneParams).strokes.find((step) => step.layer === 'casting-time')!.markup;
    const root = new DOMParser().parseFromString(`<svg>${markup}</svg>`, 'image/svg+xml');
    const copies = [...root.documentElement.children];
    expect(copies).toHaveLength(SCRIPT_SLOTS);
    expect(new Set(copies.map((copy) => copy.innerHTML)).size).toBe(SCRIPT_SLOTS);
    expect(new Set(copies.map((copy) => copy.getAttribute('transform'))).size).toBe(SCRIPT_SLOTS);
  });

  it('applies variable ink to every filled outline and school copy, preserving guide opacity', () => {
    const params = { ...defaultRuneParams, level: 9, instances: 12, damageType: 'variable' as const };
    const svg = renderStyledRuneSvg(params, { currentStroke: 1 });
    expect(svg).not.toContain('fill="currentColor"');
    expect(svg).toContain('fill="url(#rune-variable-ink)"');
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(root.querySelector('[data-stroke-order="1"]')?.getAttribute('opacity')).toBe('0.3');
    expect(root.querySelector('[data-stroke-order="2"]')?.getAttribute('opacity')).toBeNull();
    expect(root.querySelector('[data-stroke-order="3"]')?.getAttribute('opacity')).toBe('0.1');
    expect(root.querySelector('parsererror')).toBeNull();
    expect(svg).not.toMatch(/<(text|title|desc)\b/i);
    expect(root.documentElement.getAttribute('aria-label')).toBe(runeSummary(params));
  });
});

// Evaluate SVG placement transforms, including the small handwriting transforms, in order.
function placedPoint(element: Element, point: readonly number[]): readonly number[] {
  let [x, y] = point;
  for (let current: Element | null = element; current; current = current.parentElement) {
    const transforms = [...(current.getAttribute('transform') ?? '').matchAll(/(translate|rotate|scale)\(([^)]+)\)/g)].reverse();
    for (const [, operation, args] of transforms) {
      const values = args.trim().split(/[ ,]+/).map(Number);
      if (operation === 'translate') { x += values[0]; y += values[1] ?? 0; }
      if (operation === 'scale') { x *= values[0]; y *= values[1] ?? values[0]; }
      if (operation === 'rotate') {
        const [angle, cx = 0, cy = 0] = values;
        const radians = angle * Math.PI / 180;
        const dx = x - cx, dy = y - cy;
        x = cx + dx * Math.cos(radians) - dy * Math.sin(radians);
        y = cy + dx * Math.sin(radians) + dy * Math.cos(radians);
      }
    }
  }
  return [x, y];
}

describe('ballpoint clearances and ink', () => {
  it('retains at least 3:1 effective ink contrast after compositing on paper', () => {
    for (const color of [...Object.values(damageColors), ...variableGradientStops]) {
      const effective = '#' + [1, 3, 5].map((offset) => Math.round(
        parseInt(color.slice(offset, offset + 2), 16) * INK_OPACITY
        + parseInt(paperColor.slice(offset, offset + 2), 16) * (1 - INK_OPACITY),
      ).toString(16).padStart(2, '0')).join('');
      expect(contrastRatio(effective, paperColor)).toBeGreaterThanOrEqual(3);
    }
  });

  it('keeps worst-case outlines and transformed school bounds inside the viewBox and size budget', () => {
    for (const level of [0, 2, 3, 7, 8, 9]) for (const shape of ['sphere', 'cylinder'] as const) {
      for (const kind of ['self', 'sight', 'unlimited'] as const) {
        const params = { ...defaultRuneParams, level, instances: 12, concentration: true, ritual: true,
          area: { shape, sizeFeet: 9999, inferred: false }, range: { kind, distanceFeet: null } };
        const svg = renderStyledRuneSvg(params);
        expect(new TextEncoder().encode(svg).length).toBeLessThan(150_000);
        const root = new DOMParser().parseFromString(svg, 'image/svg+xml');
        expect(root.querySelector('parsererror')).toBeNull();
        const points: (readonly number[])[] = [];
        for (const path of root.querySelectorAll('path')) {
          const d = path.getAttribute('d')!;
          if (d === schoolGlyphs[params.school].d) {
            const glyph = schoolGlyphs[params.school];
            for (const x of [glyph.x, glyph.x + glyph.width]) for (const y of [glyph.y, glyph.y + glyph.height]) {
              points.push(placedPoint(path, [x, y]));
              // Every school copy stays inside either the core or its own vertex node.
              const local = placedPoint(path, [x, y]);
              const anchors = [[256, 256, CORE_RADIUS], ...levelVertices(level).map(([vx, vy]) => [vx, vy, levelNodeRadius(level)])];
              expect(anchors.some(([cx, cy, r]) => Math.hypot(local[0] - (256 + (cx - 256) * RUNE_SCALE), local[1] - (256 + (cy - 256) * RUNE_SCALE)) < (r - (r === CORE_RADIUS ? 0 : circleWobble(r)) - BALLPOINT_WIDTH * 1.25 / RUNE_SCALE / 2) * RUNE_SCALE)).toBe(true);
            }
          } else {
            for (const point of centerlinePoints(d)) points.push(placedPoint(path, point));
          }
        }
        for (const circle of root.querySelectorAll('circle')) {
          const x = Number(circle.getAttribute('cx')), y = Number(circle.getAttribute('cy')), r = Number(circle.getAttribute('r'));
          points.push(placedPoint(circle, [x - r, y - r]), placedPoint(circle, [x + r, y + r]));
        }
        expect(Math.min(...points.flat())).toBeGreaterThanOrEqual(0);
        expect(Math.max(...points.flat())).toBeLessThanOrEqual(512);
        const outer = 268 + 10 + circleWobble(8) + MAX_OVERSHOOT + BALLPOINT_WIDTH * 1.25 / RUNE_SCALE + GRAIN_DISPLACEMENT;
        expect(outer * RUNE_SCALE).toBeLessThan(256);
      }
    }
  });

  it('preserves node-to-area and spoke-to-band gaps after worst-case wobble and pressure', () => {
    const halfWidth = BALLPOINT_WIDTH * 1.25 * 1.06 / RUNE_SCALE / 2 + GRAIN_DISPLACEMENT / 2;
    for (const level of [7, 8, 9]) for (const shape of ['sphere', 'cylinder'] as const) {
      const radii = shape === 'sphere' ? [206] : [197, 207];
      const params = { ...defaultRuneParams, level, area: { shape, sizeFeet: 9999, inferred: false } };
      const area = composeStyledRune(params).strokes.find((step) => step.layer === 'area')!.markup;
      const root = new DOMParser().parseFromString(`<svg>${area}</svg>`, 'image/svg+xml');
      let minimum = Infinity;
      for (const path of root.querySelectorAll('path')) for (const [x, y] of centerlinePoints(path.getAttribute('d')!)) {
        for (const [vx, vy] of levelVertices(level)) minimum = Math.min(minimum, Math.hypot(x - vx, y - vy) - levelNodeRadius(level) - circleWobble(levelNodeRadius(level)) - halfWidth);
      }
      expect(minimum).toBeGreaterThan(0);
      for (const r of radii) expect(r - LEVEL_RADIUS - levelNodeRadius(level) - (circleWobble(r) + circleWobble(levelNodeRadius(level)) + 2 * halfWidth)).toBeGreaterThan(0);
      // Radial spokes normally stop at 204; glyphs start at radius 223 - 7.
      expect(223 - 7 * 1.08 - 0.6 - 0.3 - halfWidth - (204 + 3 + halfWidth)).toBeGreaterThan(0);
    }
  });
});

describe('action glyph', () => {
  it('fits its local box, takes two gestures and differs from all five other glyphs', () => {
    const glyphPaths = castingTimeOptions.map(({ value }) => {
      const params = { ...defaultRuneParams, castingTime: { kind: value } };
      const markup = composeRune(params).strokes.find((step) => step.layer === 'casting-time')!.markup;
      return new DOMParser().parseFromString(`<svg>${markup}</svg>`, 'image/svg+xml').querySelector('path')!.getAttribute('d')!;
    });
    expect(new Set(glyphPaths).size).toBe(6);
    const action = glyphPaths[0];
    expect(action.match(/M/g)).toHaveLength(2);
    const points = [...action.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)].map((match) => match.slice(1).map(Number));
    expect(points.length).toBeGreaterThan(4);
    for (const [x, y] of points) { expect(Math.abs(x)).toBeLessThanOrEqual(6); expect(Math.abs(y)).toBeLessThanOrEqual(7); }
    const level = composeRune({ ...defaultRuneParams, level: 7 }).strokes.find((step) => step.layer === 'level')!.markup;
    const inner = [...new DOMParser().parseFromString(`<svg>${level}</svg>`, 'image/svg+xml').querySelectorAll('path[transform]')].filter((path) => path.getAttribute('fill') !== 'currentColor');
    expect(inner).toHaveLength(12);
    expect(inner.every((path) => path.getAttribute('d') === action)).toBe(true);
    expect(describeRune(defaultRuneParams).find((item) => item.layer === 'casting-time')!.detail).toContain('due rami obliqui');
  });
});

describe('ballpoint grain filter', () => {
  it('embeds one self-contained high-frequency grain filter on the drawing group only', () => {
    const svg = renderStyledRuneSvg(defaultRuneParams);
    const root = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(root.querySelectorAll('filter')).toHaveLength(1);
    expect(root.querySelectorAll('[filter]')).toHaveLength(1);
    const id = root.querySelector('filter')!.id;
    expect(root.querySelector('[filter]')!.getAttribute('filter')).toBe(`url(#${id})`);
    expect(root.querySelector('feTurbulence')!.getAttribute('baseFrequency')).toBe('1.15');
    expect(root.querySelector('feTurbulence')!.getAttribute('numOctaves')).toBe('2');
    expect(root.querySelector('feComposite')!.getAttribute('operator')).toBe('in');
    expect(Number(root.querySelector('feDisplacementMap')!.getAttribute('scale'))).toBeGreaterThanOrEqual(0.6);
    expect(renderRuneSvg(defaultRuneParams)).not.toContain('<filter');
    const other = renderStyledRuneSvg({ ...defaultRuneParams, level: 9 });
    expect(other).not.toContain(`id="${id}"`);
  });
});

function centerlinePoints(d: string): readonly (readonly number[])[] {
  let x = 0, y = 0;
  return [...d.matchAll(/([MLl])([-\d.]+) ([-\d.]+)/g)].map((match) => {
    const a = Number(match[2]), b = Number(match[3]);
    x = match[1] === 'l' ? x + a : a;
    y = match[1] === 'l' ? y + b : b;
    return [x, y];
  });
}

describe('ballpoint worst-case serialization', () => {
  it('keeps the hour glyph with maximal copies, sphere and sight below 150 KB', () => {
    const svg = renderStyledRuneSvg({
      ...defaultRuneParams,
      level: 9,
      instances: 12,
      castingTime: { kind: 'hour' },
      area: { shape: 'sphere', sizeFeet: 9999, inferred: false },
      range: { kind: 'sight', distanceFeet: null },
      concentration: true,
      ritual: true,
    });
    expect(new TextEncoder().encode(svg).length).toBeLessThan(150_000);
  });
});
