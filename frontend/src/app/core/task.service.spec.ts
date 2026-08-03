import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { API_BASE_URL } from './api.config';
import { ProjectService } from './project.service';
import { TaskService } from './task.service';
import { Task } from '../models/task.model';

const PROJECT = 7;
const URL = `${API_BASE_URL}/projects/${PROJECT}/tasks`;

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: 'Build the API',
    description: null,
    status: 'TODO',
    priority: 'MEDIUM',
    startDate: '2026-09-01',
    endDate: '2026-09-05',
    color: '#3B82F6',
    dependsOn: [],
    blockedBy: [],
    assignee: null,
    ...overrides,
  };
}

describe('TaskService', () => {

  let service: TaskService;
  let http: HttpTestingController;

  const settled = () => new Promise(resolve => setTimeout(resolve, 0));

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ProjectService,
          useValue: { currentId: () => PROJECT, load: async () => {} },
        },
      ],
    });

    service = TestBed.inject(TaskService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function loadWith(tasks: Task[]): Promise<void> {
    const done = service.load();
    await settled();
    http.expectOne({ url: URL, method: 'GET' }).flush(tasks);
    await done;
  }

  it('keeps the assignee when only the status changes', async () => {
    const assigned = task({ assignee: { id: 4, displayName: 'Ada Lovelace' } });
    await loadWith([assigned]);

    void service.changeStatus(assigned, 'DOING');

    // The PUT replaces every mutable field, so a value left out of the payload
    // is a value set to null. Omitting assigneeId here would silently unassign
    // whoever was doing the work every time somebody moved a card along.
    const request = http.expectOne({ url: `${URL}/1`, method: 'PUT' });
    expect(request.request.body.assigneeId).toBe(4);
    expect(request.request.body.status).toBe('DOING');

    request.flush(task({ status: 'DOING', assignee: { id: 4, displayName: 'Ada Lovelace' } }));
    await settled();
    http.expectOne({ url: URL, method: 'GET' }).flush([]);
  });

  it('sends a null assignee for a task nobody is doing', async () => {
    const unassigned = task();
    await loadWith([unassigned]);

    void service.changeStatus(unassigned, 'DONE');

    const request = http.expectOne({ url: `${URL}/1`, method: 'PUT' });
    expect(request.request.body.assigneeId).toBeNull();

    request.flush(task({ status: 'DONE' }));
    await settled();
    http.expectOne({ url: URL, method: 'GET' }).flush([]);
  });

  it('puts the previous status back when the server refuses the change', async () => {
    const blocked = task({ status: 'TODO' });
    await loadWith([blocked]);

    void service.changeStatus(blocked, 'DONE');

    // Optimistic: the marker has already moved by the time the request goes.
    expect(service.tasks()[0].status).toBe('DONE');

    http.expectOne({ url: `${URL}/1`, method: 'PUT' }).flush(
      { detail: 'This task cannot be marked done until its prerequisites are finished' },
      { status: 409, statusText: 'Conflict' }
    );
    await settled();

    // A refused DONE is an ordinary outcome here, not an exception, so the row
    // has to end up exactly where it started.
    expect(service.tasks()[0].status).toBe('TODO');
    expect(service.error()).toContain('prerequisites');
  });

  it('sends the whole record when a bar is dragged, not just the dates', async () => {
    const dragged = task({ assignee: { id: 4, displayName: 'Ada Lovelace' }, priority: 'HIGH' });
    await loadWith([dragged]);

    void service.reschedule(dragged, '2026-09-10', '2026-09-14');

    // The bar is already where the pointer left it, so this is optimistic.
    expect(service.tasks()[0].startDate).toBe('2026-09-10');

    const request = http.expectOne({ url: `${URL}/1`, method: 'PUT' });
    expect(request.request.body).toMatchObject({
      startDate: '2026-09-10',
      endDate: '2026-09-14',
      // The payload replaces every mutable field, so everything the drag did
      // not touch has to ride along or it is cleared.
      assigneeId: 4,
      priority: 'HIGH',
      title: 'Build the API',
    });

    request.flush(task({ startDate: '2026-09-10', endDate: '2026-09-14' }));
    await settled();
    http.expectOne({ url: URL, method: 'GET' }).flush([]);
  });

  it('puts a dragged bar back when the server refuses the move', async () => {
    const dragged = task();
    await loadWith([dragged]);

    void service.reschedule(dragged, '2026-09-10', '2026-09-14');
    expect(service.tasks()[0].startDate).toBe('2026-09-10');

    http.expectOne({ url: `${URL}/1`, method: 'PUT' })
      .flush({ detail: 'nope' }, { status: 409, statusText: 'Conflict' });
    await settled();

    expect(service.tasks()[0].startDate).toBe('2026-09-01');
    expect(service.tasks()[0].endDate).toBe('2026-09-05');
  });

  it('explains an unreachable server rather than repeating its silence', async () => {
    const done = service.load();
    await settled();
    http.expectOne({ url: URL, method: 'GET' })
      .error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
    await done;

    expect(service.error()).toContain('Cannot reach the server');
  });

  it('reads a 403 as a role problem rather than an outage', async () => {
    const done = service.load();
    await settled();
    http.expectOne({ url: URL, method: 'GET' })
      .flush({}, { status: 403, statusText: 'Forbidden' });
    await done;

    expect(service.error()).toBe('Your role in this project does not allow that.');
  });
});
