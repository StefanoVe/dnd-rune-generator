import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { spellCatalog } from '../src/app/catalog/spell-catalog.ts';
import { renderRuneSvg } from '../src/app/domain/rune-engine.ts';
import { damageOptions, defaultRuneParams, schoolOptions } from '../src/app/domain/rune-types.ts';

const namedIds = [
  'fire-bolt',
  'fireball',
  'shield',
  'hunters-mark',
  'detect-magic',
  'wish',
  'scorching-ray',
];
const findSpell = (predicate, label) => {
  const spell = spellCatalog.spells.find(predicate);
  if (!spell) throw new Error('No catalog spell for ' + label);
  return spell;
};
const sheets = {
  contact: namedIds.map((id) => ({
    filename: id,
    spell: findSpell((candidate) => candidate.id === id, id),
  })),
  schools: schoolOptions.map(({ value }) => ({
    filename: 'school-' + value,
    spell: findSpell((candidate) => candidate.rune.school === value, value),
  })),
  damage: damageOptions.map(({ value }) => ({
    filename: 'damage-' + value,
    spell:
      value === 'variable'
        ? { rune: { ...defaultRuneParams, damageType: 'variable' } }
        : findSpell((candidate) => candidate.rune.damageType === value, value),
  })),
};

await mkdir('samples', { recursive: true });
for (const entries of Object.values(sheets)) {
  for (const { filename, spell } of entries) {
    const svgPath = 'samples/' + filename + '.svg';
    const pngPath = 'samples/' + filename + '.png';
    await writeFile(svgPath, renderRuneSvg(spell.rune));
    execFileSync(
      'magick',
      [
        '-background',
        'white',
        '-density',
        '150',
        svgPath,
        '-resize',
        '800x800',
        '-flatten',
        pngPath,
      ],
      { stdio: 'inherit' },
    );
    const dimensions = execFileSync('magick', ['identify', '-format', '%wx%h', pngPath], {
      encoding: 'utf8',
    });
    if (dimensions !== '800x800')
      throw new Error('Unexpected dimensions for ' + pngPath + ': ' + dimensions);
  }
}

for (const [name, entries] of Object.entries(sheets)) {
  const columns = name === 'contact' ? 3 : name === 'schools' ? 4 : 5;
  const cell = name === 'contact' ? 400 : 300;
  execFileSync(
    'magick',
    [
      'montage',
      ...entries.map(({ filename }) => 'samples/' + filename + '.png'),
      '-tile',
      columns + 'x',
      '-geometry',
      cell + 'x' + cell + '+10+10',
      '-background',
      'white',
      'samples/' + name + '.png',
    ],
    { stdio: 'inherit' },
  );
}
