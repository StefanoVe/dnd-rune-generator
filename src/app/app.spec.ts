import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { App } from './app';
import { composeRune } from './domain/rune-engine';
import { defaultRuneParams } from './domain/rune-types';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  });

  it('renders the generator and the complete catalog', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('h1')?.textContent).toContain('Una spell');
    expect(element.querySelector('#spell-search')?.getAttribute('role')).toBe('combobox');
    expect(element.querySelector('.rune-preview svg')).not.toBeNull();
    expect(element.querySelector('.rune-preview svg')?.getAttribute('role')).toBe('img');
    expect(element.querySelector('.rune-preview svg')?.getAttribute('aria-label')).toContain(
      'scuola',
    );
    expect(element.querySelectorAll('.legend-list li')).toHaveLength(8);
    const selectFor = (label: string) =>
      [...element.querySelectorAll<HTMLLabelElement>('label.field')]
        .find((field) => field.querySelector('span')?.textContent === label)
        ?.querySelector('select');
    expect(selectFor('Scuola')?.value).toBe(defaultRuneParams.school);
    expect(selectFor('Casting time')?.value).toBe(defaultRuneParams.castingTime.kind);
    expect(selectFor('Gittata')?.value).toBe(defaultRuneParams.range.kind);
    expect(selectFor('Area')?.value).toBe(defaultRuneParams.area.shape);
    expect(selectFor('Tipo di danno')?.value).toBe(defaultRuneParams.damageType);
  });

  it('pins a legend layer and fades the other SVG layers', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const school = element.querySelector<HTMLButtonElement>('.legend-list button')!;

    school.click();
    fixture.detectChanges();

    expect(school.getAttribute('aria-pressed')).toBe('true');
    expect(school.classList.contains('active')).toBe(true);
    expect(element.querySelector('[data-rune-layer="school"]')?.hasAttribute('opacity')).toBe(
      false,
    );
    expect(element.querySelector('[data-rune-layer="range"]')?.getAttribute('opacity')).toBe(
      '0.18',
    );
  });

  it('unpins on a second click or Escape', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const school = element.querySelector<HTMLButtonElement>('.legend-list button')!;

    school.click();
    fixture.detectChanges();
    school.click();
    fixture.detectChanges();
    expect(school.getAttribute('aria-pressed')).toBe('false');
    expect(element.querySelector('[data-rune-layer="range"]')?.hasAttribute('opacity')).toBe(false);

    school.click();
    fixture.detectChanges();
    school.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(school.getAttribute('aria-pressed')).toBe('false');
    expect(element.querySelector('[data-rune-layer="range"]')?.hasAttribute('opacity')).toBe(false);
  });

  it('shows the whole-rune colour swatch for damage', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const damage = [...element.querySelectorAll<HTMLButtonElement>('.legend-list button')].find(
      (button) => button.textContent?.includes('Colore'),
    )!;

    expect(damage.querySelector('.damage-swatch')).not.toBeNull();
    expect((damage.querySelector('.damage-swatch') as HTMLElement).style.background).not.toBe('');
    damage.click();
    fixture.detectChanges();
    expect(element.querySelector('.rune-preview [opacity]')).toBeNull();

    const damageSelect = element.querySelector<HTMLSelectElement>('.field-wide select')!;
    damageSelect.value = 'variable';
    damageSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect((damage.querySelector('.damage-swatch') as HTMLElement).style.background).toContain(
      'linear-gradient',
    );
  });

  it('marks legend items disabled while the stroke guide runs', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const start = [...element.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Avvia guida'),
    )!;

    start.click();
    await fixture.whenStable();
    const legendButtons = [...element.querySelectorAll<HTMLButtonElement>('.legend-list button')];
    expect((element.ownerDocument.activeElement as HTMLElement).textContent).toBe('Esci');
    expect(legendButtons.every((button) => button.getAttribute('aria-disabled') === 'true')).toBe(
      true,
    );
    legendButtons[0].click();
    fixture.detectChanges();
    expect(legendButtons[0].getAttribute('aria-pressed')).toBe('false');
    expect(element.querySelector('#legend-instructions')?.textContent).toContain(
      'la legenda è disattivata',
    );
    (element.ownerDocument.activeElement as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(element.ownerDocument.activeElement?.textContent?.trim()).toBe('Avvia guida');
  });

  it('loads a spell and exposes inferred area metadata', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('#spell-search') as HTMLInputElement;

    input.value = 'firebal';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    const options = [...fixture.nativeElement.querySelectorAll('[role="option"]')] as HTMLElement[];
    expect(options[0].textContent).toContain('Fireball');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();

    expect(input.value).toBe('Fireball');
    expect(fixture.nativeElement.querySelector('[role="listbox"]')).toBeNull();

    expect(fixture.nativeElement.querySelector('.rune-caption')?.textContent).toContain('Fireball');
    expect(fixture.nativeElement.querySelector('.inferred-note')).not.toBeNull();
    expect(
      (fixture.nativeElement.querySelector('.field-wide select') as HTMLSelectElement).value,
    ).toBe('fire');
  });

  it('searches ignoring apostrophes and clears back to a custom rune', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const input = element.querySelector('#spell-search') as HTMLInputElement;

    input.value = 'hunters';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(element.querySelector('[role="option"]')?.textContent).toContain("Hunter's Mark");
    (element.querySelector('[role="option"]') as HTMLElement).click();
    await fixture.whenStable();
    expect(element.querySelector('.rune-caption')?.textContent).toContain("Hunter's Mark");

    (element.querySelector('.clear-button') as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(input.value).toBe('');
    expect(element.querySelector('.search-status')?.textContent).toContain('Runa personalizzata');
  });

  it('shows inferred instances and clears the hint when edited', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const search = element.querySelector('#spell-search') as HTMLInputElement;
    const instancesField = [...element.querySelectorAll<HTMLLabelElement>('label.field')].find(
      (label) => label.querySelector('span')?.textContent === 'Istanze',
    )!;
    expect(instancesField.querySelector('input')?.value).toBe('1');

    search.value = 'scorching ray';
    search.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    (element.querySelector('[role="option"]') as HTMLElement).click();
    await fixture.whenStable();
    const input = instancesField.querySelector('input')!;
    expect(input.value).toBe('3');
    expect(instancesField.querySelector('.inferred-note')?.textContent).toContain('Ricavato');

    input.value = '2';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();
    expect(instancesField.querySelector('.inferred-note')).toBeNull();
    expect(element.querySelector('.summary')?.textContent).toContain('2 istanze');
  });

  it('steps through strokes and resets the guide when the rune changes', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const buttonNamed = (name: string): HTMLButtonElement =>
      [...element.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
        button.textContent?.includes(name),
      )!;

    buttonNamed('Avvia guida').click();
    fixture.detectChanges();
    expect(element.querySelectorAll('.rune-preview [data-stroke-order]')).toHaveLength(1);
    expect(element.querySelector('.stroke-counter')?.textContent).toContain('Passo 1');

    buttonNamed('Successivo').click();
    fixture.detectChanges();
    expect(element.querySelectorAll('.rune-preview [data-stroke-order]')).toHaveLength(2);

    const level = element.querySelector<HTMLInputElement>('input[type="number"]')!;
    level.value = '2';
    level.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(buttonNamed('Avvia guida')).toBeTruthy();
    expect(element.querySelectorAll('.rune-preview [data-stroke-order]')).toHaveLength(
      composeRune(defaultRuneParams).strokes.length,
    );
  });

  it('downloads a transparent PNG of the complete composition during the guide', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    const png = new Blob(['png'], { type: 'image/png' });
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:source-rune')
      .mockReturnValueOnce('blob:png-rune');
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    const imageSource = vi.spyOn(HTMLImageElement.prototype, 'src', 'set')
      .mockImplementation(function (this: HTMLImageElement) {
        queueMicrotask(() => this.dispatchEvent(new Event('load')));
      });
    const drawImage = vi.fn();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation(function (this: HTMLCanvasElement, callback) {
        expect(this.width).toBe(1024);
        expect(this.height).toBe(1024);
        callback(png);
      });
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        expect(this.download).toBe('runa-arcana.png');
        expect(this.href).toBe('blob:png-rune');
      });

    try {
      [...element.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.includes('Avvia guida'))!
        .click();
      fixture.detectChanges();
      element.querySelector<HTMLButtonElement>('.download-button')!.click();
      await fixture.whenStable();

      const svg = await (createObjectUrl.mock.calls[0][0] as Blob).text();
      expect(svg.match(/data-stroke-order=/g)?.length).toBe(
        composeRune(defaultRuneParams).strokes.length,
      );
      expect(svg).not.toMatch(/<(text|title|desc)\b/i);
      expect(drawImage).toHaveBeenCalledWith(expect.any(HTMLImageElement), 0, 0, 1024, 1024);
      expect(toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/png');
      expect(createObjectUrl).toHaveBeenLastCalledWith(png);
      expect(anchorClick).toHaveBeenCalledOnce();
      expect(revokeObjectUrl).toHaveBeenCalledWith('blob:source-rune');
      await vi.waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledWith('blob:png-rune'));
    } finally {
      createObjectUrl.mockRestore();
      revokeObjectUrl.mockRestore();
      imageSource.mockRestore();
      getContext.mockRestore();
      toBlob.mockRestore();
      anchorClick.mockRestore();
    }
  });
});
