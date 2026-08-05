import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

/**
 * A select whose options are generated, and a value bound to it.
 *
 * Worth a test of its own because the failure is silent and looks exactly like
 * a data bug. Binding [value] on the select assigns select.value before the
 * @for has created any options; the browser has nothing to match, falls back
 * to the first option, and never retries when the options arrive. Every row
 * then claims to be whatever happens to be listed first.
 *
 * That is what made the member roster show OWNER for an editor whose stored
 * role was, correctly, EDITOR — the invite worked and the screen lied.
 */
@Component({
  selector: 'app-host',
  template: `
    <select id="on-select" [value]="chosen()">
      @for (option of options; track option) {
        <option [value]="option">{{ option }}</option>
      }
    </select>

    <select id="on-option">
      @for (option of options; track option) {
        <option [value]="option" [selected]="option === chosen()">{{ option }}</option>
      }
    </select>
  `,
})
class Host {
  readonly options = ['OWNER', 'EDITOR', 'VIEWER'];
  readonly chosen = signal('EDITOR');
}

describe('binding a value to a generated select', () => {

  async function host() {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideZonelessChangeDetection()],
    });
    await TestBed.compileComponents();

    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      onSelect: element.querySelector<HTMLSelectElement>('#on-select')!,
      onOption: element.querySelector<HTMLSelectElement>('#on-option')!,
    };
  }

  it('shows the first option when the value is bound to the select', async () => {
    const { onSelect } = await host();

    // The bug, pinned so nobody reintroduces the pattern believing it works.
    expect(onSelect.value).toBe('OWNER');
  });

  it('shows the bound value when the option decides it is selected', async () => {
    const { onOption } = await host();
    expect(onOption.value).toBe('EDITOR');
  });

  it('follows a later change too', async () => {
    const { fixture, onOption } = await host();

    // Matters for the roster: a refused role change rolls the value back, and
    // the control has to follow it without the reader touching anything.
    fixture.componentInstance.chosen.set('VIEWER');
    await fixture.whenStable();

    expect(onOption.value).toBe('VIEWER');
  });
});
