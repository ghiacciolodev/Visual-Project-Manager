import { provideZonelessChangeDetection, signal } from '@angular/core';
import { DeferBlockBehavior, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { API_BASE_URL } from './core/api.config';
import { ProjectService } from './core/project.service';
import { Profile, SessionService } from './core/session.service';
import { Project, ProjectRole } from './models/project.model';

/**
 * The shell decides what a visitor sees before any route does: a holding
 * message while the OIDC callback settles, the sign-in gate, or the
 * application. Those three states are the whole of App's own logic, so they
 * are what this file tests.
 *
 * SessionService is replaced rather than exercised. The real one wraps
 * OidcSecurityService, and standing that up would test the library's redirect
 * handling instead of the branch the template takes once it has answered.
 */
function stubSession(state: { ready: boolean; authenticated: boolean }) {
  const profile = signal<Profile | null>(null);

  return {
    ready: signal(state.ready),
    authenticated: signal(state.authenticated),
    profile,
    initials: signal(''),
    setProfile: (value: Profile) => profile.set(value),
    signIn: () => {},
    signOut: () => {},
  };
}

/**
 * A settled project list. The real service fetches one, and every test here is
 * about what the shell draws once it has, not about the fetching.
 */
function stubProjects(role: ProjectRole = 'EDITOR') {
  const project: Project = { id: 1, name: 'Apollo', description: null, myRole: role };

  return {
    projects: signal<Project[]>([project]),
    currentId: signal(project.id),
    current: signal(project),
    loading: signal(false),
    canEdit: signal(role === 'OWNER' || role === 'EDITOR'),
    canAdminister: signal(role === 'OWNER'),
    load: async () => {},
    select: () => {},
    clear: () => {},
  };
}

async function render(state: {
  ready: boolean;
  authenticated: boolean;
  role?: ProjectRole;
}) {
  const session = stubSession(state);
  const projects = stubProjects(state.role);

  // Lets one test render twice — comparing what an editor is offered against
  // what an owner is — without the second call finding the module already up.
  TestBed.resetTestingModule();

  TestBed.configureTestingModule({
    imports: [App],
    // Defer blocks are held at their placeholder in tests unless told
    // otherwise, and the members panel is behind one.
    deferBlockBehavior: DeferBlockBehavior.Playthrough,
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SessionService, useValue: session },
      { provide: ProjectService, useValue: projects },
    ],
  });

  // App now pulls in the members panel, whose template and styles are separate
  // files: TestBed will not instantiate a component with unresolved metadata.
  await TestBed.compileComponents();

  const fixture = TestBed.createComponent(App);
  await fixture.whenStable();

  return {
    session,
    projects,
    fixture,
    element: fixture.nativeElement as HTMLElement,
    http: TestBed.inject(HttpTestingController),
  };
}

/** The rail tab, or button, carrying this label. */
function railControl(element: HTMLElement, label: string): HTMLElement | undefined {
  return [...element.querySelectorAll<HTMLElement>('.rail__tab')]
    .find(tab => tab.textContent?.trim() === label);
}

describe('App', () => {

  it('renders neither the gate nor the application until the session check settles', async () => {
    const { element } = await render({ ready: false, authenticated: false });

    // Routing before checkAuth has answered would flash the schedule for a
    // frame and then redirect, which reads as a glitch rather than a load.
    expect(element.textContent).toContain('Checking your session');
    expect(element.querySelector('router-outlet')).toBeNull();
    expect(element.textContent).not.toContain('Sign in');
  });

  it('offers sign-in when the check finds no session', async () => {
    const { element } = await render({ ready: true, authenticated: false });

    expect(element.textContent).toContain('Sign in to open your schedule');
    expect(element.querySelector('router-outlet')).toBeNull();

    // The rail carries the navigation, and there is nothing to navigate to
    // while signed out.
    expect(element.querySelector('.rail__tab')).toBeNull();
  });

  it('shows the navigation and the routed view once signed in', async () => {
    const { element } = await render({ ready: true, authenticated: true });

    const tabs = [...element.querySelectorAll('.rail__tab')].map(tab => tab.textContent?.trim());

    expect(tabs).toContain('Schedule');
    expect(tabs).toContain('Chart');
    expect(element.querySelector('router-outlet')).not.toBeNull();
  });

  it('provisions the local account by asking the backend who the caller is', async () => {
    const { session, fixture, http } = await render({ ready: true, authenticated: true });

    // The token already carries a name and an email, so this call looks
    // redundant — it is the request that creates the row, the project and the
    // sample data on a first sign-in.
    const request = http.expectOne(`${API_BASE_URL}/me`);
    request.flush({ id: 7, email: 'ada@example.com', displayName: 'Ada Lovelace' });

    // flush() emits synchronously, but the component awaits firstValueFrom, so
    // the assignment lands a microtask later.
    await fixture.whenStable();

    expect(session.profile()?.displayName).toBe('Ada Lovelace');
  });

  it('offers the members panel to owners only', async () => {
    const asEditor = await render({ ready: true, authenticated: true, role: 'EDITOR' });
    asEditor.http.expectOne(`${API_BASE_URL}/me`).flush(null);
    expect(railControl(asEditor.element, 'Members')).toBeUndefined();

    const asOwner = await render({ ready: true, authenticated: true, role: 'OWNER' });
    asOwner.http.expectOne(`${API_BASE_URL}/me`).flush(null);
    expect(railControl(asOwner.element, 'Members')).toBeDefined();
  });

  it('opens the members panel over the current view rather than replacing it', async () => {
    const { element, fixture, http } = await render({
      ready: true, authenticated: true, role: 'OWNER',
    });
    http.expectOne(`${API_BASE_URL}/me`).flush(null);

    railControl(element, 'Members')!.click();
    await fixture.whenStable();

    // The panel opening must not take the schedule away. Routing to it did
    // exactly that: the outlet swapped the view out and the panel slid over a
    // blank sheet.
    expect(element.querySelector('.panel')).not.toBeNull();
    expect(element.querySelector('router-outlet')).not.toBeNull();

    // The panel loads its roster on open.
    http.expectOne(`${API_BASE_URL}/projects/1/members`).flush([]);
    await fixture.whenStable();

    // Dismissing puts it away again — @defer alone would leave it rendered.
    element.querySelector<HTMLElement>('.scrim')!.click();
    await fixture.whenStable();

    expect(element.querySelector('.panel')).toBeNull();
    expect(element.querySelector('router-outlet')).not.toBeNull();
  });

  it('leaves the header unnamed when the profile call fails', async () => {
    const { session, fixture, element, http } = await render({ ready: true, authenticated: true });

    http.expectOne(`${API_BASE_URL}/me`)
      .flush('nope', { status: 500, statusText: 'Server Error' });

    await fixture.whenStable();

    // Every other view reports its own failures. Surfacing this one too would
    // show two errors for one outage — the header simply goes unnamed and the
    // application stays usable.
    expect(session.profile()).toBeNull();
    expect(element.querySelector('.who')).toBeNull();
    expect(element.querySelector('router-outlet')).not.toBeNull();
  });
});
