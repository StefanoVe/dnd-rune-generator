import {
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { schoolOptions, type CatalogSpell } from '../domain/rune-types';

const normalize = (value: string): string =>
  value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'`]/g, '').toLocaleLowerCase('en').trim();

const schoolLabels = new Map<string, string>(schoolOptions.map((o) => [o.value, o.label]));

/** Accessible combobox (WAI-ARIA APG "list autocomplete") to pick a catalog spell. */
@Component({
  selector: 'app-spell-search',
  styleUrl: './spell-search.css',
  host: { '(focusout)': 'onFocusOut($event)' },
  template: `
    <label class="search-label" for="spell-search">Cerca una spell</label>
    <div class="search-box">
      <input
        id="spell-search"
        type="text"
        role="combobox"
        autocomplete="off"
        spellcheck="false"
        aria-autocomplete="list"
        aria-controls="spell-listbox"
        [attr.aria-expanded]="open()"
        [attr.aria-activedescendant]="open() && activeIndex() >= 0 ? optionId(activeIndex()) : null"
        placeholder="Es. Fireball, oppure lascia vuoto per una runa personalizzata"
        [value]="text()"
        (input)="onInput($event)"
        (focus)="openList()"
        (click)="openList()"
        (keydown)="onKeydown($event)"
      />
      @if (text() || selectedId()) {
        <button
          class="clear-button"
          type="button"
          aria-label="Svuota ricerca e torna alla runa personalizzata"
          (click)="clear()"
        >
          <span aria-hidden="true">×</span>
        </button>
      }
    </div>

    @if (open()) {
      <ul id="spell-listbox" class="results" role="listbox" aria-label="Spell trovate">
        @for (spell of results(); track spell.id; let index = $index) {
          <li
            role="option"
            [id]="optionId(index)"
            [attr.aria-selected]="spell.id === selectedId()"
            [class.active]="index === activeIndex()"
            (mousedown)="$event.preventDefault()"
            (click)="choose(spell)"
            (mousemove)="activeIndex.set(index)"
          >
            <span class="result-name">{{ spell.name }}</span>
            <span class="result-meta">{{ meta(spell) }}</span>
          </li>
        } @empty {
          <li class="no-results" role="option" aria-disabled="true" aria-selected="false">
            Nessuna spell trovata
          </li>
        }
      </ul>
    }
    <p class="search-status" aria-live="polite">
      @if (selectedSpell(); as spell) {
        Runa di <strong>{{ spell.name }}</strong>
      } @else {
        Runa personalizzata · {{ spells().length }} spell nel catalogo
      }
      @if (open()) {
        <span class="sr-only">, {{ results().length }} risultati</span>
      }
    </p>
  `,
})
export class SpellSearch {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  readonly spells = input.required<readonly CatalogSpell[]>();
  readonly selectedId = input('');
  readonly spellSelected = output<string>();

  protected readonly selectedSpell = computed(
    () => this.spells().find((spell) => spell.id === this.selectedId()) ?? null,
  );
  /** Text in the box: follows the selected spell, but the user can type over it. */
  protected readonly text = linkedSignal(() => this.selectedSpell()?.name ?? '');
  /** Only filter once the user has typed; on focus show the full list. */
  private readonly filtering = signal(false);
  protected readonly open = signal(false);
  protected readonly activeIndex = signal(-1);

  protected readonly results = computed(() => {
    const spells = this.spells();
    const query = normalize(this.text());
    if (!this.filtering() || !query) return spells;
    const starts: CatalogSpell[] = [];
    const contains: CatalogSpell[] = [];
    for (const spell of spells) {
      const name = normalize(spell.name);
      if (name.startsWith(query)) starts.push(spell);
      else if (name.includes(query)) contains.push(spell);
    }
    return [...starts, ...contains];
  });

  protected optionId(index: number): string {
    return `spell-option-${index}`;
  }

  protected meta(spell: CatalogSpell): string {
    const level = spell.rune.level === 0 ? 'Trucchetto' : `Livello ${spell.rune.level}`;
    return `${level} · ${schoolLabels.get(spell.rune.school) ?? spell.rune.school}`;
  }

  protected openList(): void {
    if (this.open()) return;
    this.open.set(true);
    const selected = this.results().findIndex((spell) => spell.id === this.selectedId());
    this.activeIndex.set(selected);
    if (selected >= 0) this.scrollActiveIntoView();
  }

  protected onInput(event: Event): void {
    this.text.set((event.target as HTMLInputElement).value);
    this.filtering.set(true);
    this.open.set(true);
    this.activeIndex.set(this.results().length ? 0 : -1);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const count = this.results().length;
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        event.preventDefault();
        if (!this.open()) {
          this.openList();
          return;
        }
        if (!count) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        this.activeIndex.update((index) => (index < 0 ? 0 : (index + step + count) % count));
        this.scrollActiveIntoView();
        return;
      }
      case 'Enter': {
        const spell = this.results()[this.activeIndex()];
        if (this.open() && spell) {
          event.preventDefault();
          this.choose(spell);
        }
        return;
      }
      case 'Escape':
        event.preventDefault();
        if (this.open()) this.close();
        else this.clear();
        return;
      case 'Tab':
        this.close();
        return;
    }
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next || !this.host.nativeElement.contains(next)) this.close();
  }

  protected choose(spell: CatalogSpell): void {
    this.text.set(spell.name);
    this.filtering.set(false);
    this.open.set(false);
    this.spellSelected.emit(spell.id);
  }

  protected clear(): void {
    this.text.set('');
    this.filtering.set(false);
    this.open.set(false);
    if (this.selectedId()) this.spellSelected.emit('');
    this.host.nativeElement.querySelector('input')?.focus();
  }

  /** Closing restores the box to the current selection, discarding a half-typed query. */
  private close(): void {
    this.open.set(false);
    this.filtering.set(false);
    this.text.set(this.selectedSpell()?.name ?? '');
  }

  private scrollActiveIntoView(): void {
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector(`#${this.optionId(this.activeIndex())}`)
          ?.scrollIntoView?.({ block: 'nearest' }),
      { injector: this.injector },
    );
  }
}
