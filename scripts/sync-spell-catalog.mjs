#!/usr/bin/env node

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseInstances } from './parse-instances.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(
  projectRoot,
  process.argv.find((argument) => argument.startsWith('--source='))?.slice('--source='.length) ??
    '../dnd-2024-character/catalog/dnd-2024',
);
const destination = resolve(projectRoot, 'src/app/catalog/spells.generated.json');

const damageTypes = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
];

const areaPatterns = [
  ['sphere', /\b([\d,]+)-foot(?:-radius)? sphere\b/i],
  ['cone', /\b([\d,]+)-foot cone\b/i],
  ['cube', /\b([\d,]+)-foot cube\b/i],
  ['cylinder', /\b([\d,]+)-foot(?:-radius)? cylinder\b/i],
  ['line', /\b([\d,]+)-foot-long(?:,? [\d,]+-foot-wide)? line\b/i],
  ['emanation', /\b([\d,]+)-foot emanation\b/i],
  ['square', /\b([\d,]+)-foot square\b/i],
];

function numberFrom(value) {
  const parsed = Number.parseInt(String(value).replaceAll(',', ''), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCastingTime(value) {
  const clean = value.replaceAll('*', '').trim().toLowerCase();
  if (clean.includes('bonus action')) return { kind: 'bonus-action' };
  if (clean.includes('reaction')) return { kind: 'reaction' };
  if (clean.includes('action')) return { kind: 'action' };
  if (clean.includes('special')) return { kind: 'special' };

  if (clean.includes('minute')) return { kind: 'minute' };
  if (clean.includes('hour')) return { kind: 'hour' };
  return { kind: 'special' };
}

function normalizeRange(value) {
  const clean = value.trim().toLowerCase();
  if (clean.startsWith('self')) return { kind: 'self', distanceFeet: null };
  if (clean.startsWith('touch')) return { kind: 'touch', distanceFeet: null };
  if (clean.startsWith('sight')) return { kind: 'sight', distanceFeet: null };
  if (clean.startsWith('unlimited')) return { kind: 'unlimited', distanceFeet: null };

  const feet = clean.match(/^([\d,]+)\s*ft\./i);
  if (feet) return { kind: 'distance', distanceFeet: numberFrom(feet[1]) };

  const miles = clean.match(/^([\d,]+)\s*miles?/i);
  if (miles) return { kind: 'distance', distanceFeet: (numberFrom(miles[1]) ?? 0) * 5280 };

  return { kind: 'special', distanceFeet: null };
}

function normalizeArea(description) {
  for (const [shape, pattern] of areaPatterns) {
    const match = description.match(pattern);
    if (match) return { shape, sizeFeet: numberFrom(match[1]), inferred: true };
  }
  return { shape: 'none', sizeFeet: null, inferred: false };
}

function normalizeDamage(value) {
  const lower = value.toLowerCase();
  const matches = damageTypes.filter((damageType) =>
    new RegExp(`\\b${damageType}\\b`, 'i').test(lower),
  );
  if (matches.length === 0) return 'none';
  return matches.length === 1 ? matches[0] : 'variable';
}

const manifest = JSON.parse(await readFile(resolve(sourceRoot, 'manifest.json'), 'utf8'));
const descriptions = JSON.parse(
  await readFile(resolve(sourceRoot, 'spell-descriptions.json'), 'utf8'),
);
const spellDirectory = resolve(sourceRoot, 'spells');
const spellFiles = (await readdir(spellDirectory)).filter((file) => file.endsWith('.json')).sort();
const deduplicated = new Map();

for (const file of spellFiles) {
  const records = JSON.parse(await readFile(resolve(spellDirectory, file), 'utf8'));
  for (const spell of records) deduplicated.set(spell.id, spell);
}

const spells = [...deduplicated.values()]
  .sort((left, right) => left.name.localeCompare(right.name, 'en'))
  .map((spell) => ({
    id: spell.id,
    name: spell.name,
    sourceUrl: spell.sourceUrl,
    source: {
      level: spell.level,
      castingTime: spell.castingTime,
      range: spell.range,
      damageEffect: spell.damageEffect,
    },
    rune: {
      level: spell.level,
      school: spell.school.toLowerCase(),
      castingTime: normalizeCastingTime(spell.castingTime),
      ...parseInstances(descriptions[spell.id] ?? ''),
      range: normalizeRange(spell.range),
      area: normalizeArea(descriptions[spell.id] ?? ''),
      damageType: normalizeDamage(spell.damageEffect),
      concentration: spell.concentration,
      ritual: spell.ritual,
    },
  }));

const output = {
  schemaVersion: 1,
  sourceCatalog: manifest.catalogId,
  sourceSnapshotAt: manifest.snapshotAt,
  sourceUrl: manifest.source,
  redistributionNotice: manifest.attribution,
  spellCount: spells.length,
  spells,
};

await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${spells.length} unique spells to ${destination}`);
const inferred = spells.filter((spell) => spell.rune.instancesInferred);
const largest = [...inferred]
  .sort(
    (left, right) => right.rune.instances - left.rune.instances || left.id.localeCompare(right.id),
  )
  .slice(0, 15);
console.log(`Inferred instances for ${inferred.length} of ${spells.length} spells`);
console.log(
  'Largest inferred values: ' +
    largest.map((spell) => `${spell.id}=${spell.rune.instances}`).join(', '),
);
