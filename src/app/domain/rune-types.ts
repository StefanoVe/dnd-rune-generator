export const schoolOptions = [
  { value: 'abjuration', label: 'Abiurazione' },
  { value: 'conjuration', label: 'Evocazione' },
  { value: 'divination', label: 'Divinazione' },
  { value: 'enchantment', label: 'Ammaliamento' },
  { value: 'evocation', label: 'Invocazione' },
  { value: 'illusion', label: 'Illusione' },
  { value: 'necromancy', label: 'Necromanzia' },
  { value: 'transmutation', label: 'Trasmutazione' },
] as const;

export const castingTimeOptions = [
  { value: 'action', label: 'Azione' },
  { value: 'bonus-action', label: 'Azione bonus' },
  { value: 'reaction', label: 'Reazione' },
  { value: 'minute', label: 'Minuti' },
  { value: 'hour', label: 'Ore' },
  { value: 'special', label: 'Speciale' },
] as const;

export const rangeOptions = [
  { value: 'self', label: 'Sé' },
  { value: 'touch', label: 'Contatto' },
  { value: 'distance', label: 'Distanza' },
  { value: 'sight', label: 'Vista' },
  { value: 'unlimited', label: 'Illimitata' },
  { value: 'special', label: 'Speciale' },
] as const;

export const areaOptions = [
  { value: 'none', label: 'Nessuna' },
  { value: 'sphere', label: 'Sfera' },
  { value: 'cone', label: 'Cono' },
  { value: 'cube', label: 'Cubo' },
  { value: 'cylinder', label: 'Cilindro' },
  { value: 'line', label: 'Linea' },
  { value: 'emanation', label: 'Emanazione' },
  { value: 'square', label: 'Quadrato' },
  { value: 'custom', label: 'Personalizzata' },
] as const;

export const damageOptions = [
  { value: 'none', label: 'Nessuno' },
  { value: 'acid', label: 'Acido' },
  { value: 'bludgeoning', label: 'Contundente' },
  { value: 'cold', label: 'Freddo' },
  { value: 'fire', label: 'Fuoco' },
  { value: 'force', label: 'Forza' },
  { value: 'lightning', label: 'Fulmine' },
  { value: 'necrotic', label: 'Necrotico' },
  { value: 'piercing', label: 'Perforante' },
  { value: 'poison', label: 'Veleno' },
  { value: 'psychic', label: 'Psichico' },
  { value: 'radiant', label: 'Radiante' },
  { value: 'slashing', label: 'Tagliente' },
  { value: 'thunder', label: 'Tuono' },
  { value: 'variable', label: 'Variabile' },
] as const;

export type MagicSchool = (typeof schoolOptions)[number]['value'];
export type CastingTimeKind = (typeof castingTimeOptions)[number]['value'];
export type RangeKind = (typeof rangeOptions)[number]['value'];
export type AreaShape = (typeof areaOptions)[number]['value'];
export type DamageType = (typeof damageOptions)[number]['value'];

export type RuneLayer =
  | 'level'
  | 'school'
  | 'casting-time'
  | 'range'
  | 'area'
  | 'damage'
  | 'seal'
  | 'concentration'
  | 'ritual';

export interface SpellRuneParams {
  readonly level: number;
  readonly school: MagicSchool;
  readonly castingTime: {
    readonly kind: CastingTimeKind;
  };
  readonly instances: number;
  readonly instancesInferred: boolean;
  readonly range: {
    readonly kind: RangeKind;
    readonly distanceFeet: number | null;
  };
  readonly area: {
    readonly shape: AreaShape;
    readonly sizeFeet: number | null;
    readonly inferred: boolean;
  };
  readonly damageType: DamageType;
  readonly concentration: boolean;
  readonly ritual: boolean;
}

export interface CatalogSpell {
  readonly id: string;
  readonly name: string;
  readonly sourceUrl: string;
  readonly source: {
    readonly level: number;
    readonly castingTime: string;
    readonly range: string;
    readonly damageEffect: string;
  };
  readonly rune: SpellRuneParams;
}

export interface RuneExplanation {
  readonly layer: RuneLayer;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}

/** One construction step of the rune: a group of SVG elements belonging to a single layer. */
export interface RuneStroke {
  readonly id: string;
  readonly order: number;
  readonly layer: RuneLayer;
  /** SVG markup drawn inside the step's group; inherits colour and the uniform stroke width. */
  readonly markup: string;
}

export interface RuneComposition {
  readonly params: SpellRuneParams;
  readonly color: string;
  readonly strokes: readonly RuneStroke[];
}

export interface RuneRenderOptions {
  readonly style?: 'ballpoint' | 'clean';
  readonly penNoise?: number;
  readonly visibleStrokeCount?: number;
  readonly currentStroke?: number;
  readonly highlightedLayer?: RuneLayer;
}

export const defaultRuneParams: SpellRuneParams = {
  level: 1,
  school: 'evocation',
  castingTime: { kind: 'action' },
  instances: 1,
  instancesInferred: false,
  range: { kind: 'distance', distanceFeet: 60 },
  area: { shape: 'sphere', sizeFeet: 10, inferred: false },
  damageType: 'fire',
  concentration: false,
  ritual: false,
};
