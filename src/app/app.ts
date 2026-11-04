import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { spellCatalog } from './catalog/spell-catalog';
import { SpellSearch } from './spell-search/spell-search';
import { DEFAULT_PEN_NOISE, normalizePenNoise } from './domain/pen';
import { variableGradientStops } from './domain/damage-colors';
import { composeRune, describeRune, renderRuneSvg, runeSummary } from './domain/rune-engine';
import {
  areaOptions,
  castingTimeOptions,
  damageOptions,
  defaultRuneParams,
  rangeOptions,
  schoolOptions,
  type AreaShape,
  type CastingTimeKind,
  type DamageType,
  type MagicSchool,
  type RangeKind,
  type RuneLayer,
  type SpellRuneParams,
} from './domain/rune-types';

@Component({
  selector: 'app-root',
  imports: [SpellSearch],
  host: { '(keydown.escape)': 'onEscape()' },
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly guideExitButton = viewChild<ElementRef<HTMLButtonElement>>('guideExitButton');
  private readonly guideStartButton = viewChild<ElementRef<HTMLButtonElement>>('guideStartButton');

  protected readonly schoolOptions = schoolOptions;
  protected readonly castingTimeOptions = castingTimeOptions;
  protected readonly rangeOptions = rangeOptions;
  protected readonly areaOptions = areaOptions;
  protected readonly damageOptions = damageOptions;
  protected readonly catalog = spellCatalog;

  protected readonly selectedSpellId = signal('');
  protected readonly runeParams = signal<SpellRuneParams>(defaultRuneParams);
  protected readonly penNoise = signal(DEFAULT_PEN_NOISE);
  protected readonly penNoiseDescription = computed(() => {
    const value = this.penNoise();
    const description = value === 0 ? 'tratto perfetto' : value <= 20 ? 'mano precisa' : value <= 50 ? 'mano naturale' : value < 100 ? 'mano tremante' : 'tremore marcato';
    return `${value} – ${description}`;
  });
  protected readonly hoveredLayer = signal<RuneLayer | undefined>(undefined);
  protected readonly focusedLayer = signal<RuneLayer | undefined>(undefined);
  protected readonly pinnedLayer = signal<RuneLayer | undefined>(undefined);
  protected readonly guideActive = signal(false);
  protected readonly currentStroke = signal(0);
  protected readonly exporting = signal(false);
  protected readonly exportError = signal('');

  protected readonly selectedSpell = computed(
    () => this.catalog.spells.find((spell) => spell.id === this.selectedSpellId()) ?? null,
  );
  protected readonly explanation = computed(() => describeRune(this.runeParams()));
  protected readonly summary = computed(() => runeSummary(this.runeParams()));
  protected readonly composition = computed(() => composeRune(this.runeParams(), { penNoise: this.penNoise() }));
  protected readonly activeLayer = computed(() =>
    this.guideActive()
      ? undefined
      : (this.hoveredLayer() ?? this.focusedLayer() ?? this.pinnedLayer()),
  );
  protected readonly damageSwatch = computed(() =>
    this.runeParams().damageType === 'variable'
      ? `linear-gradient(90deg, ${variableGradientStops.join(', ')})`
      : this.composition().color,
  );
  protected readonly strokeCount = computed(() => this.composition().strokes.length);
  protected readonly safePreview = computed(() => {
    const composition = this.composition();
    const svg = this.guideActive()
      ? renderRuneSvg(composition, {
          visibleStrokeCount: this.currentStroke() + 1,
          currentStroke: this.currentStroke(),
        })
      : renderRuneSvg(composition, {
          highlightedLayer: this.activeLayer() === 'damage' ? undefined : this.activeLayer(),
        });
    return this.sanitizer.bypassSecurityTrustHtml(svg);
  });

  protected selectSpell(id: string): void {
    const spell = this.catalog.spells.find((candidate) => candidate.id === id);
    this.selectedSpellId.set(id);
    if (spell) this.runeParams.set(structuredClone(spell.rune));
    this.exitStrokeGuide();
  }

  protected resetSpell(): void {
    const spell = this.selectedSpell();
    this.runeParams.set(spell ? structuredClone(spell.rune) : defaultRuneParams);
    this.exitStrokeGuide();
  }

  protected setPenNoise(event: Event): void {
    this.penNoise.set(normalizePenNoise(this.eventNumber(event)));
  }

  protected setLevel(event: Event): void {
    this.patch((params) => ({ ...params, level: this.eventNumber(event) }));
  }

  protected setSchool(event: Event): void {
    this.patch((params) => ({ ...params, school: this.eventValue(event) as MagicSchool }));
  }

  protected setCastingKind(event: Event): void {
    this.patch((params) => ({
      ...params,
      castingTime: { ...params.castingTime, kind: this.eventValue(event) as CastingTimeKind },
    }));
  }

  protected setInstances(event: Event): void {
    this.patch((params) => ({
      ...params,
      instances: Math.min(24, Math.max(1, Math.round(this.eventNumber(event)))),
      instancesInferred: false,
    }));
  }

  protected setRangeKind(event: Event): void {
    const kind = this.eventValue(event) as RangeKind;
    this.patch((params) => ({
      ...params,
      range: { kind, distanceFeet: kind === 'distance' ? (params.range.distanceFeet ?? 30) : null },
    }));
  }

  protected setRangeDistance(event: Event): void {
    this.patch((params) => ({
      ...params,
      range: { ...params.range, distanceFeet: this.eventNumber(event) },
    }));
  }

  protected setAreaShape(event: Event): void {
    const shape = this.eventValue(event) as AreaShape;
    this.patch((params) => ({
      ...params,
      area: {
        shape,
        sizeFeet: shape === 'none' ? null : (params.area.sizeFeet ?? 5),
        inferred: false,
      },
    }));
  }

  protected setAreaSize(event: Event): void {
    this.patch((params) => ({
      ...params,
      area: { ...params.area, sizeFeet: this.eventNumber(event), inferred: false },
    }));
  }

  protected setDamageType(event: Event): void {
    this.patch((params) => ({ ...params, damageType: this.eventValue(event) as DamageType }));
  }

  protected setConcentration(event: Event): void {
    this.patch((params) => ({ ...params, concentration: this.eventChecked(event) }));
  }

  protected setRitual(event: Event): void {
    this.patch((params) => ({ ...params, ritual: this.eventChecked(event) }));
  }

  protected previewHover(layer: RuneLayer | undefined): void {
    if (this.guideActive()) return;
    this.hoveredLayer.set(layer);
  }

  protected previewFocus(layer: RuneLayer | undefined): void {
    if (this.guideActive()) return;
    this.focusedLayer.set(layer);
  }

  protected togglePinnedLayer(layer: RuneLayer): void {
    if (this.guideActive()) return;
    this.pinnedLayer.update((current) => (current === layer ? undefined : layer));
    this.hoveredLayer.set(undefined);
    this.focusedLayer.set(undefined);
  }

  protected startStrokeGuide(): void {
    this.hoveredLayer.set(undefined);
    this.focusedLayer.set(undefined);
    this.pinnedLayer.set(undefined);
    this.currentStroke.set(0);
    this.guideActive.set(true);
    afterNextRender(() => this.guideExitButton()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected previousStroke(): void {
    this.currentStroke.update((value) => Math.max(0, value - 1));
  }

  protected nextStroke(): void {
    this.currentStroke.update((value) => Math.min(this.strokeCount() - 1, value + 1));
  }

  protected exitStrokeGuide(restoreFocus = false): void {
    this.guideActive.set(false);
    this.currentStroke.set(0);
    if (restoreFocus) {
      afterNextRender(() => this.guideStartButton()?.nativeElement.focus(), {
        injector: this.injector,
      });
    }
  }

  protected onEscape(): void {
    this.hoveredLayer.set(undefined);
    this.focusedLayer.set(undefined);
    this.pinnedLayer.set(undefined);
  }

  protected async downloadPng(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.exportError.set('');
    const filename = `${this.selectedSpellId() || 'runa-arcana'}.png`;
    const svg = renderRuneSvg(this.composition());
    const sourceUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    let downloadUrl: string | undefined;
    try {
      const image = this.document.createElement('img');
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error('Unable to load rune image'));
        image.src = sourceUrl;
      });
      const canvas = this.document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 1024;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable');
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error('Unable to encode PNG'));
        }, 'image/png');
      });
      downloadUrl = URL.createObjectURL(blob);
      const link = this.document.createElement('a');
      link.href = downloadUrl;
      link.download = filename;
      link.click();
    } catch {
      this.exportError.set('Impossibile esportare la runa. Riprova.');
    } finally {
      URL.revokeObjectURL(sourceUrl);
      if (downloadUrl) {
        const url = downloadUrl;
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      this.exporting.set(false);
    }
  }

  private patch(update: (params: SpellRuneParams) => SpellRuneParams): void {
    this.runeParams.update(update);
    this.exitStrokeGuide();
  }

  private eventValue(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  private eventNumber(event: Event): number {
    return Number(this.eventValue(event));
  }

  private eventChecked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }
}
