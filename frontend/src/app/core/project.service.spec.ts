import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { API_BASE_URL } from './api.config';
import { ProjectService } from './project.service';
import { Project, ProjectRole } from '../models/project.model';

const URL = `${API_BASE_URL}/projects`;

function project(id: number, name: string, myRole: ProjectRole = 'OWNER'): Project {
  return { id, name, description: null, myRole };
}

describe('ProjectService', () => {

  let service: ProjectService;
  let http: HttpTestingController;

  const settled = () => new Promise(resolve => setTimeout(resolve, 0));

  beforeEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });

    service = TestBed.inject(ProjectService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function loadWith(projects: Project[]): Promise<void> {
    const done = service.load();
    http.expectOne({ url: URL, method: 'GET' }).flush(projects);
    await done;
  }

  it('switches to a project as soon as it is created', async () => {
    await loadWith([project(1, 'Apollo')]);

    const pending = service.create('Gemini', null);
    http.expectOne({ url: URL, method: 'POST' }).flush(project(2, 'Gemini'));
    await pending;

    // Somebody who has just made a project wants to be looking at it, so this
    // is not a second decision for the caller to remember to make.
    expect(service.currentId()).toBe(2);
    expect(service.projects().map(p => p.name)).toEqual(['Apollo', 'Gemini']);
    expect(localStorage.getItem('vpm.project')).toBe('2');
  });

  it('replaces the renamed project in place', async () => {
    await loadWith([project(1, 'Apollo'), project(2, 'Gemini')]);

    const pending = service.rename(1, 'Artemis', 'The return');
    http.expectOne({ url: `${URL}/1`, method: 'PUT' })
      .flush({ id: 1, name: 'Artemis', description: 'The return', myRole: 'OWNER' });
    await pending;

    expect(service.projects().map(p => p.name)).toEqual(['Artemis', 'Gemini']);
    // Renaming must not reorder the picker under the reader's cursor.
    expect(service.projects()[0].id).toBe(1);
  });

  it('settles on what is left after deleting the project on screen', async () => {
    await loadWith([project(1, 'Apollo'), project(2, 'Gemini')]);
    service.select(1);

    const pending = service.remove(1);
    http.expectOne({ url: `${URL}/1`, method: 'DELETE' }).flush(null);
    await pending;

    expect(service.projects().map(p => p.id)).toEqual([2]);
    expect(service.currentId()).toBe(2);
  });

  it('leaves nothing selected when the last project goes', async () => {
    await loadWith([project(1, 'Apollo')]);

    const pending = service.remove(1);
    http.expectOne({ url: `${URL}/1`, method: 'DELETE' }).flush(null);
    await pending;

    // A person can delete their way down to nothing, and the remembered id
    // has to go with it — otherwise the next sign-in asks for a project that
    // no longer exists and every screen answers 404.
    expect(service.currentId()).toBeNull();
    expect(localStorage.getItem('vpm.project')).toBeNull();
  });

  it('keeps the current project when another one is deleted', async () => {
    await loadWith([project(1, 'Apollo'), project(2, 'Gemini')]);
    service.select(2);

    const pending = service.remove(1);
    http.expectOne({ url: `${URL}/1`, method: 'DELETE' }).flush(null);
    await pending;

    expect(service.currentId()).toBe(2);
  });

  it('does not drop the project locally when the server refuses the delete', async () => {
    await loadWith([project(1, 'Apollo')]);

    const attempt = service.remove(1);
    http.expectOne({ url: `${URL}/1`, method: 'DELETE' })
      .flush({}, { status: 403, statusText: 'Forbidden' });

    await expect(attempt).rejects.toThrow('That project is not yours to change.');

    // Not optimistic on purpose: everything on screen belongs to this project,
    // and putting it all back would be far more than one signal.
    expect(service.projects().map(p => p.id)).toEqual([1]);
    expect(service.currentId()).toBe(1);
  });

  it('refetches on reload where load would have returned the cache', async () => {
    await loadWith([project(1, 'Apollo')]);

    // load() returns early once anything is cached — that guard is what stops
    // every view refetching on navigation, and it is exactly what is wrong
    // after a write.
    await service.load();

    const pending = service.reload();
    await settled();
    http.expectOne({ url: URL, method: 'GET' })
      .flush([project(1, 'Apollo'), project(2, 'Gemini')]);
    await pending;

    expect(service.projects()).toHaveLength(2);
  });

  it('reports a rejected name by its field message', async () => {
    await loadWith([project(1, 'Apollo')]);

    const attempt = service.rename(1, '   ', null);
    http.expectOne({ url: `${URL}/1`, method: 'PUT' }).flush(
      { errors: { name: 'Name is required' } },
      { status: 400, statusText: 'Bad Request' }
    );

    await expect(attempt).rejects.toThrow('Name is required');
  });

  it('reads a 404 as a project that is not yours rather than an outage', async () => {
    await loadWith([project(1, 'Apollo')]);

    const attempt = service.rename(1, 'Mine now', null);
    http.expectOne({ url: `${URL}/1`, method: 'PUT' })
      .flush({}, { status: 404, statusText: 'Not Found' });

    // The server answers 404 to a stranger so an id cannot be used to probe
    // for projects that exist. To the person holding it, that is the same
    // answer as 403 and should read the same way.
    await expect(attempt).rejects.toThrow('That project is not yours to change.');
  });
});
