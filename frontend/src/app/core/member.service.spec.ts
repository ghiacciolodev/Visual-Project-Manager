import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';

import { apiBaseUrl } from './api.config';
import { MemberService, MembershipConflict } from './member.service';
import { ProjectService } from './project.service';
import { Member } from '../models/project.model';

const PROJECT = 42;
const URL = `${apiBaseUrl()}/projects/${PROJECT}/members`;

function member(overrides: Partial<Member> = {}): Member {
  return {
    userId: 1,
    email: 'ada@example.com',
    displayName: 'Ada Lovelace',
    role: 'OWNER',
    signedUp: true,
    ...overrides,
  };
}

describe('MemberService', () => {

  let service: MemberService;
  let http: HttpTestingController;

  /**
   * Drains the microtask queue.
   *
   * load() awaits the project list before it builds a URL, so the request does
   * not exist yet on the line after the call — expecting it there finds
   * nothing, and the response arrives afterwards to fail verify() as well.
   */
  const settled = () => new Promise(resolve => setTimeout(resolve, 0));

  beforeEach(() => {
    // Without this, one failing expectation leaves the module instantiated and
    // every later test reports a confusing "already instantiated" instead of
    // its own result.
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        // Stubbed to a settled project: what is under test is the roster, and
        // the real load() would add a projects request to every case.
        {
          provide: ProjectService,
          useValue: { currentId: () => PROJECT, load: async () => {} },
        },
      ],
    });

    service = TestBed.inject(MemberService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function loadWith(members: Member[]): Promise<void> {
    const done = service.load();
    await settled();
    http.expectOne({ url: URL, method: 'GET' }).flush(members);
    await done;
  }

  it('orders owners before editors before viewers', async () => {
    await loadWith([
      member({ userId: 2, displayName: 'Bea', role: 'VIEWER' }),
      member({ userId: 1, displayName: 'Ada', role: 'OWNER' }),
    ]);

    // Kept in step with the server's own ordering so a locally inserted row
    // lands where a reload would put it.
    expect(service.members().map(m => m.displayName)).toEqual(['Ada', 'Bea']);

    const pending = service.invite('cy@example.com', 'EDITOR');
    http.expectOne({ url: URL, method: 'POST' })
      .flush(member({ userId: 9, displayName: 'Cy', role: 'EDITOR' }));
    await pending;

    // An editor sorts above a viewer, so the new row lands in the middle
    // rather than on the end where it was appended.
    expect(service.members().map(m => m.displayName)).toEqual(['Ada', 'Cy', 'Bea']);
  });

  it('puts the previous role back when the server refuses the change', async () => {
    await loadWith([
      member({ userId: 1, displayName: 'Ada', role: 'OWNER' }),
      member({ userId: 2, displayName: 'Bea', role: 'EDITOR' }),
    ]);

    const attempt = service.changeRole(1, 'VIEWER');

    // Optimistic: the select has already moved by the time the request goes out.
    expect(service.members().find(m => m.userId === 1)?.role).toBe('VIEWER');

    http.expectOne({ url: `${URL}/1`, method: 'PATCH' }).flush(
      { detail: "This is the project's only owner. Make somebody else an owner first." },
      { status: 409, statusText: 'Conflict' }
    );

    await expect(attempt).rejects.toThrow(MembershipConflict);

    // A project with no owner can never be administered again, so this refusal
    // is a normal outcome rather than a failure — and the row has to end up
    // exactly where it started.
    expect(service.members().find(m => m.userId === 1)?.role).toBe('OWNER');
  });

  it('carries the wording the server chose for a refused change', async () => {
    await loadWith([member({ userId: 1, role: 'OWNER' })]);

    const attempt = service.changeRole(1, 'EDITOR');
    http.expectOne({ url: `${URL}/1`, method: 'PATCH' }).flush(
      { detail: "This is the project's only owner. Make somebody else an owner first." },
      { status: 409, statusText: 'Conflict' }
    );

    // The panel prints this under the row, so a generic message would lose the
    // one instruction the reader needs.
    await expect(attempt).rejects.toThrow(/only owner/);
  });

  it('restores a removed member when the delete fails', async () => {
    await loadWith([
      member({ userId: 1, displayName: 'Ada', role: 'OWNER' }),
      member({ userId: 2, displayName: 'Bea', role: 'EDITOR' }),
    ]);

    const attempt = service.remove(2);
    expect(service.members()).toHaveLength(1);

    http.expectOne({ url: `${URL}/2`, method: 'DELETE' }).flush(
      { detail: 'nope' }, { status: 409, statusText: 'Conflict' }
    );

    await expect(attempt).rejects.toThrow(MembershipConflict);
    expect(service.members().map(m => m.userId)).toEqual([1, 2]);
  });

  it('reports a rejected address by its field message', async () => {
    await loadWith([]);

    const attempt = service.invite('not-an-email', 'EDITOR');
    http.expectOne({ url: URL, method: 'POST' }).flush(
      { errors: { email: 'That does not look like an email address' } },
      { status: 400, statusText: 'Bad Request' }
    );

    await expect(attempt).rejects.toThrow('That does not look like an email address');
  });

  it('explains a 403 as a role problem rather than an outage', async () => {
    const done = service.load();
    await settled();
    http.expectOne({ url: URL, method: 'GET' })
      .flush({}, { status: 403, statusText: 'Forbidden' });
    await done;

    expect(service.error()).toBe('Only an owner can change who is in this project.');
  });

  it('keeps an invited member distinguishable from a quiet one', async () => {
    await loadWith([
      member({ userId: 1, displayName: 'Ada', signedUp: true }),
      member({ userId: 2, displayName: 'Bea', role: 'EDITOR', signedUp: false }),
    ]);

    expect(service.members().find(m => m.userId === 2)?.signedUp).toBe(false);
  });
});
