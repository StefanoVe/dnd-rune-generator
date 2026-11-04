import {
  ballpointGesture,
  ballpointPen,
  cleanPen,
  BALLPOINT_WIDTH,
  MAX_WOBBLE,
  MAX_OVERSHOOT,
  INK_OPACITY,
  hashSeed,
  circleWobble,
} from './pen';

const radial = (point: readonly number[]): number => Math.hypot(point[0], point[1]);

describe('ballpoint gestures', () => {
  it('uses FNV-1a seeds and deterministic, distinct handwriting', () => {
    expect(hashSeed('hello')).toBe(0x4f9f2cab);
    expect(ballpointPen('a').circle([0, 0], 100)).toBe(ballpointPen('a').circle([0, 0], 100));
    expect(ballpointPen('a').circle([0, 0], 100)).not.toBe(ballpointPen('b').circle([0, 0], 100));
    expect(ballpointPen('a').line([0, 0], [150, 0])).not.toBe(cleanPen.line([0, 0], [150, 0]));
  });

  it('requires visible relative seal deformation and two overlapping gestures', () => {
    for (let seed = 0; seed < 50; seed++) {
      const gestures = ballpointGesture(String(seed), {
        kind: 'circle',
        center: [0, 0],
        radius: 244,
      });
      expect(gestures.length).toBeGreaterThanOrEqual(2);
      const deviation = Math.max(
        ...gestures.flatMap((gesture) =>
          gesture.points.map((point) => Math.abs(radial(point) - 244)),
        ),
      );
      expect(deviation).toBeGreaterThanOrEqual(244 * 0.015);
      expect(deviation).toBeLessThanOrEqual(244 * 0.04 + 0.01);
      for (const gesture of gestures) expect(gesture.overlapDegrees).toBeGreaterThanOrEqual(15);
      // Compare the two passes at the SAME closing angle, not the Euclidean distance
      // across a 15-degree overlap. Interpolate the preceding pass at that angle.
      const end = gestures[1].points.at(-1)!;
      const angle = Math.atan2(end[1], end[0]);
      const first = gestures[0].points.slice(1);
      let nearest = first[0];
      let best = Infinity;
      for (const point of first) {
        const difference = Math.abs(
          Math.atan2(
            Math.sin(Math.atan2(point[1], point[0]) - angle),
            Math.cos(Math.atan2(point[1], point[0]) - angle),
          ),
        );
        if (difference < best) {
          best = difference;
          nearest = point;
        }
      }
      const separation = Math.abs(radial(end) - radial(nearest));
      expect(separation).toBeGreaterThanOrEqual(2);
      expect(separation).toBeLessThanOrEqual(8);
    }
  });

  it('requires long-line bow, pressure variation and ink-density variation', () => {
    for (let seed = 0; seed < 50; seed++) {
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
      expect(
        Math.max(...gesture.opacities) - Math.min(...gesture.opacities),
      ).toBeGreaterThanOrEqual(0.15);
    }
  });

  it('bounds circles with element-specific envelopes and retains a capillary groove', () => {
    for (let seed = 0; seed < 20; seed++)
      for (const radius of [3, 8, 18, 168, 178, 192, 197, 206, 207, 244]) {
        const gestures = ballpointGesture(String(seed), { kind: 'circle', center: [0, 0], radius });
        for (const gesture of gestures)
          for (const point of gesture.points)
            expect(Math.abs(radial(point) - radius)).toBeLessThanOrEqual(
              circleWobble(radius) + 0.01,
            );
      }
    const markup = ballpointPen('groove').line([0, 0], [150, 0]);
    expect([...markup.matchAll(/stroke-width="([^"]+)"/g)].some((match) => Number(match[1]) === 0.68)).toBe(true);
    expect(markup).toContain('stroke-opacity=');
    expect(BALLPOINT_WIDTH).toBeGreaterThanOrEqual(1.5);
    expect(BALLPOINT_WIDTH).toBeLessThanOrEqual(1.9);
    expect(MAX_WOBBLE).toBe(244 * 0.04);
    expect(MAX_OVERSHOOT).toBe(5);
    expect(INK_OPACITY).toBeLessThan(1);
  });
});
