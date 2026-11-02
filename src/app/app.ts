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
  protected readonly hoveredLayer = signal<RuneLayer | undefined>(undefined);
  protected readonly focusedLayer = signal<RuneLayer | undefined>(undefined);
  protected readonly pinnedLayer = signal<RuneLayer | undefined>(undefined);
  protected readonly guideActive = signal(false);
  protected readonly currentStroke = signal(0);

  protected readonly selectedSpell = computed(
    () => this.catalog.spells.find((spell) => spell.id === this.selectedSpellId()) ?? null,
  );
  protected readonly explanation = computed(() => describeRune(this.runeParams()));
  protected readonly summary = computed(() => runeSummary(this.runeParams()));
  protected readonly composition = computed(() => composeRune(this.runeParams()));
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

  protected downloadSvg(): void {
    const svg = renderRuneSvg(this.composition());
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = this.document.createElement('a');
    link.href = url;
    link.download = `${this.selectedSpellId() || 'runa-arcana'}.svg`;
    link.click();
    URL.revokeObjectURL(url);
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
