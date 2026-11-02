const numberWords = new Map([
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
]);

const number = '(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\\d+)';
const instanceNoun =
  '(?:rays?|darts?|beams?|bolts?|missiles?|meteors?|motes?|orbs?|spheres?|globes?|lances?|spears?|arrows?|blades?|daggers?|creatures?|targets?|objects?|elementals?|spirits?|duplicates?|lights?)';
const instancePattern = new RegExp(
  '\\b(?:up to[ \\t]+)?(' +
    number +
    ')(?![-\\w])[ \\t]+((?:[a-z]+[ \\t]+){0,3})' +
    instanceNoun +
    '\\b',
  'gi',
);
const placementPattern = new RegExp(
  '\\b(?:orbs?|meteors?)\\b[^.!?\\n]{0,100}\\b(' +
    number +
    ')(?![-\\w])[ \\t]+different[ \\t]+points\\b',
  'i',
);
const measurementWords =
  /\b(?:feet|foot|miles?|days?|hours?|minutes?|rounds?|hit|points?|level|slots?|gp)\b/i;

export function parseInstances(description) {
  const baseText = description.split(/Using a Higher-Level Spell Slot|Cantrip Upgrade/i, 1)[0];
  const match = [...baseText.matchAll(instancePattern)].find(
    (candidate) => !measurementWords.test(candidate[2]),
  );
  const count = match ? match[1] : baseText.match(placementPattern)?.[1];
  if (!count) return { instances: 1, instancesInferred: false };
  const raw = numberWords.get(count.toLowerCase()) ?? Number(count);
  return { instances: Math.max(1, Math.min(12, raw)), instancesInferred: true };
}
