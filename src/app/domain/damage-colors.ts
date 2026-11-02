import type { DamageType } from './rune-types';

/** Paper colour of the app; every ink must reach WCAG non-text contrast (3:1) against it. */
export const paperColor = '#eee2c5';

/** Ink colour of the whole rune, chosen by damage type. */
export const damageColors: Readonly<Record<Exclude<DamageType, 'variable'>, string>> = {
  none: '#241b35',
  acid: '#5a7f00',
  bludgeoning: '#6b5546',
  cold: '#2a6fb0',
  fire: '#c03a17',
  force: '#007c86',
  lightning: '#6a4bd2',
  necrotic: '#474a1c',
  piercing: '#80561c',
  poison: '#2c7a34',
  psychic: '#ad2879',
  radiant: '#9e6400',
  slashing: '#97203a',
  thunder: '#465a6b',
};

/** "Variable" damage is drawn with a gradient through the elemental inks. */
export const variableGradientStops: readonly string[] = [
  damageColors.fire,
  damageColors.lightning,
  damageColors.cold,
  damageColors.acid,
];

export const damageColorNames: Readonly<Record<DamageType, string>> = {
  none: 'inchiostro scuro',
  acid: 'verde acido',
  bludgeoning: 'grigio pietra',
  cold: 'blu ghiaccio',
  fire: 'rosso fuoco',
  force: 'ciano',
  lightning: 'viola elettrico',
  necrotic: 'oliva cupo',
  piercing: 'bronzo',
  poison: 'verde veleno',
  psychic: 'magenta',
  radiant: 'oro ambrato',
  slashing: 'cremisi',
  thunder: 'grigio tempesta',
  variable: 'sfumatura elementale',
};

function channel(hex: string, offset: number): number {
  const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
