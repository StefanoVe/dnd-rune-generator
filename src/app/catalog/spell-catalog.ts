import catalogData from './spells.generated.json';
import type { CatalogSpell } from '../domain/rune-types';

interface GeneratedCatalog {
  readonly sourceCatalog: string;
  readonly sourceSnapshotAt: string;
  readonly sourceUrl: string;
  readonly redistributionNotice: string;
  readonly spellCount: number;
  readonly spells: readonly CatalogSpell[];
}

export const spellCatalog = catalogData as GeneratedCatalog;
