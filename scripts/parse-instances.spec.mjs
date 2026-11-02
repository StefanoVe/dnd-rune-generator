import { expect, it } from 'vitest';
import { parseInstances } from './parse-instances.mjs';

it.each([
  ['You hurl three fiery rays at your enemies.', 3, true],
  ['You create three glowing darts of magical force.', 3, true],
  ['You bless up to three creatures within range.', 3, true],
  ['You hurl a beam of crackling energy. Cantrip Upgrade. The spell creates two beams.', 1, false],
  ['A bright light fills a 20-foot-radius sphere.', 1, false],
])('infers base-level instances from %s', (description, instances, instancesInferred) => {
  expect(parseInstances(description)).toEqual({ instances, instancesInferred });
});
