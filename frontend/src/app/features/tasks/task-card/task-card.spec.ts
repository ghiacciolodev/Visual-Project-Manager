import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { TaskCard } from './task-card';
import { Task } from '../../../models/task.model';

function task(over: Partial<Task> & { id: number }): Task {
  return {
    title: `Task ${over.id}`,
    description: 'Notes a real task would carry',
    status: 'TODO',
    priority: 'MEDIUM',
    startDate: '2026-03-10',
    endDate: '2026-03-14',
    color: '#3B82F6',
    dependsOn: [],
    blockedBy: [],
    assignee: null,
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

@Component({
  selector: 'app-host',
  imports: [TaskCard],
  template: `
    @for (t of rows(); track t.id; let i = $index) {
      <app-task-row [task]="t" [index]="i" [tier]="tier()" [readonly]="readonly()" />
    }
  `,
})
class Host {
  readonly rows = signal<Task[]>([]);
  readonly readonly = signal(false);
  // The row no longer measures anything: the timeline beside it does. What it
  // takes now is how much room the divider has left it.
  readonly tier = signal<'narrow' | 'mid' | 'wide'>('wide');
}

async function render(rows: Task[], readonly = false) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    imports: [Host],
    providers: [provideZonelessChangeDetection()],
  });
  await TestBed.compileComponents();

  const fixture = TestBed.createComponent(Host);
  fixture.componentInstance.readonly.set(readonly);
  fixture.componentInstance.rows.set(rows);
  await fixture.whenStable();

  return { fixture, element: fixture.nativeElement as HTMLElement };
}

describe('TaskCard', () => {

  it('names the assignee and marks nothing when there is none', async () => {
    const { element } = await render([
      task({ id: 1, assignee: { id: 4, displayName: 'Ada Lovelace' } }),
      task({ id: 2 }),
    ]);

    const rows = element.querySelectorAll('.row');
    expect(rows[0].querySelector('.assignee__name')?.textContent?.trim()).toBe('Ada Lovelace');
    // No chip on an unassigned row: an "Unassigned" marker on every card
    // spends the reader's attention on the absence of information.
    expect(rows[1].querySelector('.assignee')).toBeNull();
  });

  it('builds initials from a name and from an email address', async () => {
    const { element } = await render([
      task({ id: 1, assignee: { id: 1, displayName: 'Ada Lovelace' } }),
      // Somebody invited by email who has never signed in: their display name
      // is their address until Keycloak supplies a real one.
      task({ id: 2, assignee: { id: 2, displayName: 'noor@example.com' } }),
      task({ id: 3, assignee: { id: 3, displayName: 'Prince' } }),
    ]);

    const initials = [...element.querySelectorAll('.assignee__initials')]
      .map(el => el.textContent?.trim());

    expect(initials).toEqual(['AL', 'NE', 'PR']);
  });

  it('states what a task is waiting for instead of only that it is blocked', async () => {
    const { element } = await render([
      task({ id: 1, blockedBy: [{ id: 9, title: 'Build the API', status: 'DOING' }] }),
    ]);

    // "Waits for Build the API" tells you what to do next; an icon only tells
    // you that you cannot.
    expect(element.querySelector('.blocked')?.textContent).toContain('Build the API');
  });

  it('offers a viewer no controls at all', async () => {
    const { element } = await render([task({ id: 1 })], true);

    // Not disabled controls: a greyed-out row invites the question of how to
    // enable it, when the answer is a conversation with the project's owner.
    expect(element.querySelector('.select')).toBeNull();
    expect(element.querySelector('.link')).toBeNull();
    expect(element.querySelector('.row__viewing')?.textContent?.trim()).toBe('View only');
  });

  /**
   * A budget on markup rather than on milliseconds.
   *
   * Measured before deciding whether the dashboard needed virtualising: at 500
   * rows the first render costs a few hundred milliseconds and editing one row
   * costs four, flat, because OnPush and track-by-id keep an edit local. The
   * conclusion was to leave the list alone — which only holds while a row
   * stays roughly this size.
   *
   * Timings would be the direct measure and are flaky on shared CI hardware.
   * Node count is deterministic, and it is the thing that actually grew.
   */
  it('keeps a row within its DOM budget', async () => {
    const { element } = await render(
      Array.from({ length: 20 }, (_, i) => task({ id: i + 1 }))
    );

    const perRow = element.querySelectorAll('*').length / 20;
    expect(perRow).toBeLessThanOrEqual(40);
  });
});
