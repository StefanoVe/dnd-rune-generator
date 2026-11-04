import {
  ballpointGesture,
  ballpointPen,
  cleanPen,
  BALLPOINT_WIDTH,
  hashSeed,
  circleWobble,
  flattenSvgPath,
  hatchPolygons,
  pointInPolygons,
  noiseFactor,
} from './pen';
import { schoolGlyphs } from './school-glyphs';

const radial = (point: readonly number[]): number => Math.hypot(point[0], point[1]);

describe('ballpoint gestures', () => {
  it('uses FNV-1a seeds and deterministic, distinct handwriting', () => {
    expect(hashSeed('hello')).toBe(0x4f9f2cab);
    expect(ballpointPen('a').circle([0, 0], 100)).toBe(ballpointPen('a').circle([0, 0], 100));
    expect(ballpointPen('a').circle([0, 0], 100)).not.toBe(ballpointPen('b').circle([0, 0], 100));
    expect(ballpointPen('a').line([0, 0], [150, 0])).not.toBe(cleanPen.line([0, 0], [150, 0]));
  });

  it('draws every solid circle in exactly one gesture with one closing overlap', () => {
    for (const radius of [3, 8, 18, 168, 178, 192, 197, 206, 207, 244]) {
      const gestures = ballpointGesture('single', { kind: 'circle', center: [0, 0], radius });
      expect(gestures).toHaveLength(1);
      expect(gestures[0].overlapDegrees).toBeGreaterThan(0);
      expect(gestures[0].overlapDegrees).toBeLessThan(61);
    }
    expect(
      ballpointGesture('dash', { kind: 'circle', center: [0, 0], radius: 206, dashed: true })
        .length,
    ).toBeGreaterThan(20);
  });

  it('has exact zero-noise geometry, constant width, full opacity and no ink events', () => {
    const circle = ballpointGesture('zero', { kind: 'circle', center: [0, 0], radius: 244 }, 0)[0];
    for (const point of circle.points)
      expect(Math.abs(radial(point) - 244)).toBeLessThanOrEqual(0.05);
    expect(circle.overlapDegrees).toBe(0);
    const line = ballpointGesture(
      'zero',
      { kind: 'line', from: [0, 0], to: [150, 0], corner: true },
      0,
    )[0];
    for (const [, y] of line.points) expect(y).toBe(0);
    expect(line.points[0]).toEqual([0, 0]);
    expect(line.points.at(-1)).toEqual([150, 0]);
    for (const gesture of [circle, line]) {
      expect(new Set(gesture.widths).size).toBe(1);
      expect(gesture.opacities.every((value) => value === 1)).toBe(true);
      expect(gesture.blot || gesture.groove || gesture.skip).toBe(false);
    }
    const markup = ballpointPen('zero', 0).circle([256, 256], 244);
    expect(markup).toContain('r="244"');
    expect(markup).not.toContain('data-pen-event');
  });

  it('increases seal deviation monotonically without changing its starting angle or seed', () => {
    expect(noiseFactor(0)).toBe(0);
    expect(noiseFactor(35)).toBe(1);
    for (let seed = 0; seed < 30; seed++) {
      const gestures = [0, 35, 70, 100].map(
        (noise) =>
          ballpointGesture(String(seed), { kind: 'circle', center: [0, 0], radius: 244 }, noise)[0],
      );
      expect(new Set(gestures.map((gesture) => gesture.startAngle)).size).toBe(1);
      const deviations = gestures.map((gesture) =>
        Math.max(...gesture.points.map((point) => Math.abs(radial(point) - 244))),
      );
      for (let i = 1; i < deviations.length; i++)
        expect(deviations[i]).toBeGreaterThan(deviations[i - 1]);
      expect(deviations[1]).toBeGreaterThanOrEqual(244 * 0.015);
      expect(deviations[1]).toBeLessThanOrEqual(244 * 0.04 + 0.01);
    }
  });

  it('keeps natural line bow and pressure, with saturated ink and only rare partial grooves', () => {
    let grooves = 0;
    for (let seed = 0; seed < 400; seed++) {
      const gesture = ballpointGesture(String(seed), {
        kind: 'line',
        from: [0, 0],
        to: [150, 0],
      })[0];
      const first = gesture.points[0],
        last = gesture.points.at(-1)!;
      const length = Math.hypot(last[0] - first[0], last[1] - first[1]);
      const bow = Math.max(
        ...gesture.points.map(
          ([x, y]) =>
            Math.abs(
              (last[0] - first[0]) * (first[1] - y) - (first[0] - x) * (last[1] - first[1]),
            ) / length,
        ),
      );
      expect(bow).toBeGreaterThanOrEqual(150 * 0.005);
      expect(Math.max(...gesture.widths) / Math.min(...gesture.widths)).toBeGreaterThanOrEqual(1.3);
      expect(Math.min(...gesture.opacities)).toBeGreaterThanOrEqual(0.9);
      if (gesture.groove) grooves++;
    }
    expect(grooves / 400).toBeGreaterThanOrEqual(0.15);
    expect(grooves / 400).toBeLessThanOrEqual(0.2);
    const long = ballpointGesture('fast', { kind: 'line', from: [0, 0], to: [500, 0] })[0];
    expect(Math.min(...long.opacities)).toBeGreaterThanOrEqual(0.82);
    expect(BALLPOINT_WIDTH).toBe(1.7);
  });

  it('retains specific circle envelopes through noise 50', () => {
    for (const noise of [0, 35, 50])
      for (let seed = 0; seed < 20; seed++) {
        for (const radius of [3, 8, 18, 168, 178, 192, 197, 206, 207, 244]) {
          const gesture = ballpointGesture(
            String(seed),
            { kind: 'circle', center: [0, 0], radius },
            noise,
          )[0];
          for (const point of gesture.points)
            expect(Math.abs(radial(point) - radius)).toBeLessThanOrEqual(
              circleWobble(radius, false, noise) + 0.01,
            );
        }
      }
  });
});

describe('SVG school geometry without a DOM', () => {
  it('parses absolute and relative M/L/H/V/C/S/Q/T/A/Z, implicit repeats and packed arc flags', () => {
    const absolute =
      'M0 0 L10 0 H20 V10 C20 20 30 20 30 10 S40 0 40 10 Q45 20 50 10 T60 10 A10 5 30 0 1 70 20 Z';
    const relative =
      'm0 0 l10 0 h10 v10 c0 10 10 10 10 0 s10 -10 10 0 q5 10 10 0 t10 0 a10 5 30 01 10 10 z';
    const a = flattenSvgPath(absolute),
      b = flattenSvgPath(relative);
    expect(a).toHaveLength(1);
    expect(a[0].length).toBeGreaterThan(40);
    expect(a[0].length).toBe(b[0].length);
    for (let i = 0; i < a[0].length; i++) {
      expect(a[0][i][0]).toBeCloseTo(b[0][i][0], 8);
      expect(a[0][i][1]).toBeCloseTo(b[0][i][1], 8);
    }
    expect(flattenSvgPath('M1 2 3 4 5 6')[0]).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
    expect(flattenSvgPath('M0 0A10 10 0 0110 10')[0].at(-1)![0]).toBeCloseTo(10, 8);
  });

  it('flattens curved geometry within 0.05 final units and applies placement before testing', () => {
    const arc = flattenSvgPath('M10 0 A10 10 0 1 1 -10 0', { scale: 2, dx: 50, dy: 70 })[0];
    for (let i = 1; i < arc.length; i++) {
      const a = arc[i - 1],
        b = arc[i];
      expect(
        Math.abs(Math.hypot((a[0] + b[0]) / 2 - 50, (a[1] + b[1]) / 2 - 70) - 20),
      ).toBeLessThanOrEqual(0.05);
    }
    // Collinear controls which reverse direction must not collapse to a chord.
    const curve = flattenSvgPath('M0 0 C100 0 -100 0 1 0')[0];
    expect(Math.max(...curve.map(([x]) => x))).toBeGreaterThan(20);
    expect(Math.min(...curve.map(([x]) => x))).toBeLessThan(-20);
  });

  it('honours nonzero winding, including oppositely directed holes and same-direction nesting', () => {
    const ring = flattenSvgPath('M0 0H20V20H0Z M5 5V15H15V5Z');
    expect(pointInPolygons([2, 10], ring)).toBe(true);
    expect(pointInPolygons([10, 10], ring)).toBe(false);
    const nested = flattenSvgPath('M0 0H20V20H0Z M5 5H15V15H5Z');
    expect(pointInPolygons([10, 10], nested)).toBe(true);
    expect(pointInPolygons([10, 10], nested, 'evenodd')).toBe(false);
    for (const [a, b] of hatchPolygons(ring, 2, Math.PI / 4))
      expect(pointInPolygons([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ring)).toBe(true);
  });

  it('outlines and hatches every original school, with bounded hatching and interior midpoints', () => {
    for (const glyph of Object.values(schoolGlyphs)) {
      const scale = 102 / Math.max(glyph.width, glyph.height);
      const dx = 256 - scale * (glyph.x + glyph.width / 2),
        dy = 256 - scale * (glyph.y + glyph.height / 2);
      const contours = flattenSvgPath(glyph.d, { scale, dx, dy });
      const points = contours.flat();
      const minX = Math.min(...points.map(([x]) => x)),
        maxX = Math.max(...points.map(([x]) => x));
      const minY = Math.min(...points.map(([, y]) => y)),
        maxY = Math.max(...points.map(([, y]) => y));
      const hatch = hatchPolygons(contours, 4, Math.PI / 4);
      expect(hatch.length).toBeGreaterThan(0);
      for (const [a, b] of hatch) {
        for (const [x, y] of [a, b]) {
          expect(x).toBeGreaterThanOrEqual(minX - 1e-8);
          expect(x).toBeLessThanOrEqual(maxX + 1e-8);
          expect(y).toBeGreaterThanOrEqual(minY - 1e-8);
          expect(y).toBeLessThanOrEqual(maxY + 1e-8);
        }
        expect(pointInPolygons([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], contours)).toBe(true);
      }
      const markup = ballpointPen('school', 0).glyph(
        glyph.d,
        `translate(${dx} ${dy}) scale(${scale})`,
        [256, 256],
      );
      expect(markup).toContain('data-pen-part="outline"');
      expect(markup).toContain('data-pen-part="hatch"');
      expect(markup).not.toContain('fill="currentColor"');
      expect(markup).not.toContain('clipPath');
      expect(markup).not.toContain('data-pen-event');
    }
  });
});

describe('rendered school hatch geometry', () => {
  it('keeps zero-noise hatch points bounded and their rendered midpoints inside the nonzero fill', () => {
    for (const glyph of Object.values(schoolGlyphs)) {
      const scale = 102 / Math.max(glyph.width, glyph.height);
      const dx = 256 - scale * (glyph.x + glyph.width / 2),
        dy = 256 - scale * (glyph.y + glyph.height / 2);
      const contours = flattenSvgPath(glyph.d, { scale, dx, dy });
      const points = contours.flat();
      const bounds = [
        Math.min(...points.map(([x]) => x)),
        Math.max(...points.map(([x]) => x)),
        Math.min(...points.map(([, y]) => y)),
        Math.max(...points.map(([, y]) => y)),
      ];
      const markup = ballpointPen('rendered', 0).glyph(
        glyph.d,
        `translate(${dx} ${dy}) scale(${scale})`,
        [256, 256],
      );
      const root = new DOMParser().parseFromString(`<svg>${markup}</svg>`, 'image/svg+xml');
      const hatches = [...root.querySelectorAll('[data-pen-part="hatch"] path')];
      expect(hatches.length).toBeGreaterThan(0);
      for (const path of hatches)
        for (const line of flattenSvgPath(path.getAttribute('d')!)) {
          for (const [x, y] of line) {
            expect(x).toBeGreaterThanOrEqual(bounds[0] - 0.01);
            expect(x).toBeLessThanOrEqual(bounds[1] + 0.01);
            expect(y).toBeGreaterThanOrEqual(bounds[2] - 0.01);
            expect(y).toBeLessThanOrEqual(bounds[3] + 0.01);
          }
          const a = line[0],
            b = line.at(-1)!;
          expect(pointInPolygons([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], contours)).toBe(true);
        }
    }
  });
});

describe('maximum-noise ring closure', () => {
  it('misses the prior pass by 8–15 units radially, with just one closing overlap', () => {
    for (const radius of [168, 197, 207, 244])
      for (let seed = 0; seed < 30; seed++) {
        const [gesture] = ballpointGesture(
          String(seed),
          { kind: 'circle', center: [0, 0], radius },
          100,
        );
        const end = gesture.points.at(-1)!;
        const angle = Math.atan2(end[1], end[0]);
        let nearest = gesture.points[0],
          error = Infinity;
        for (const point of gesture.points.slice(0, Math.floor(gesture.points.length * 0.8))) {
          const delta = Math.abs(
            Math.atan2(
              Math.sin(Math.atan2(point[1], point[0]) - angle),
              Math.cos(Math.atan2(point[1], point[0]) - angle),
            ),
          );
          if (delta < error) {
            nearest = point;
            error = delta;
          }
        }
        const gap = Math.abs(Math.hypot(...end) - Math.hypot(...nearest));
        expect(gap).toBeGreaterThanOrEqual(8);
        expect(gap).toBeLessThanOrEqual(15);
      }
  });
});

describe('localized ink at reversals', () => {
  it('adds a small deposit at a tight turn and removes it at zero noise', () => {
    const shape = {
      kind: 'polyline' as const,
      points: [
        [0, 0],
        [10, 0],
        [1, 1],
      ] as const,
      detailScale: 1,
    };
    let deposits = 0;
    for (let seed = 0; seed < 100; seed++) {
      const gesture = ballpointGesture(String(seed), shape)[0];
      if (gesture.turnBlot) {
        expect(gesture.turnBlot).toEqual([10, 0]);
        deposits++;
      }
      expect(ballpointGesture(String(seed), shape, 0)[0].turnBlot).toBeUndefined();
    }
    expect(deposits).toBeGreaterThan(20);
    expect(deposits).toBeLessThan(45);
  });
});

describe('dashed sphere ink', () => {
  it('gives individual dashes their own pressure and localized deposits', () => {
    const gestures = ballpointGesture('dashes', {
      kind: 'circle',
      center: [256, 256],
      radius: 206,
      dashed: true,
    });
    expect(new Set(gestures.map((gesture) => gesture.widths[0])).size).toBeGreaterThan(5);
    expect(gestures.some((gesture) => gesture.blot)).toBe(true);
    expect(gestures.some((gesture) => !gesture.blot)).toBe(true);
  });
});

describe('hatch placement stability', () => {
  it('anchors hatch rows to each copy rather than the page origin', () => {
    const shape = flattenSvgPath('M0 0H20V20H0Z');
    const shifted = shape.map((contour) => contour.map(([x, y]) => [x + 113, y + 207] as const));
    const original = hatchPolygons(shape, 3, 0.7);
    const translated = hatchPolygons(shifted, 3, 0.7);
    expect(translated).toHaveLength(original.length);
    for (let i = 0; i < original.length; i++)
      for (let j = 0; j < 2; j++) {
        expect(translated[i][j][0] - 113).toBeCloseTo(original[i][j][0], 8);
        expect(translated[i][j][1] - 207).toBeCloseTo(original[i][j][1], 8);
      }
  });
});
