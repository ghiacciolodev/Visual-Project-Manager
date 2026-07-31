import { Component, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { API_BASE_URL } from './core/api.config';
import { Profile, SessionService } from './core/session.service';
import { MemberService } from './core/member.service';
import { ProjectService } from './core/project.service';
import { TaskService } from './core/task.service';
import { MembersPanel } from './features/members/members-panel/members-panel';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MembersPanel],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {

  readonly session = inject(SessionService);
  readonly projects = inject(ProjectService);

  private readonly tasks = inject(TaskService);
  private readonly members = inject(MemberService);
  private readonly http = inject(HttpClient);

  /** The membership panel, which opens over the current view rather than replacing it. */
  readonly membersOpen = signal(false);

  constructor() {
    // Fetches the profile once the session is established. An effect rather
    // than ngOnInit because authentication is resolved by an app initializer
    // that may finish before or after this component exists — and because it
    // also covers signing in later from the gate.
    effect(() => {
      if (this.session.authenticated() && !this.session.profile()) {
        void this.loadProfile();
      }
    });
  }

  /**
   * Switching project reloads everything downstream.
   *
   * Not a route change: the project is not in the URL, so there is nothing for
   * the router to react to. Doing it explicitly here is clearer than a signal
   * effect firing reloads from three places at once.
   */
  onProjectChange(event: Event): void {
    const id = Number((event.target as HTMLSelectElement).value);
    this.projects.select(id);

    // The roster belonged to the project just left. Dropping it rather than
    // refetching keeps the request for whoever actually opens the panel.
    this.members.clear();
    void this.tasks.reloadFor();

    // A role is a property of the pairing, so the same person can own the
    // project they left and only read the one they arrived at. The panel is
    // owner-only, and leaving it open would sit it on a roster whose every
    // request now comes back 403.
    if (!this.projects.canAdminister()) {
      this.membersOpen.set(false);
    }
  }

  openMembers(): void {
    this.membersOpen.set(true);
  }

  closeMembers(): void {
    this.membersOpen.set(false);
  }

  /**
   * The caller removed their own membership.
   *
   * Everything on screen belonged to a project they are no longer in, so the
   * list is refetched from scratch rather than edited: which project they land
   * on next is the server's answer, not one this client can work out.
   */
  async onLeftProject(): Promise<void> {
    this.membersOpen.set(false);
    this.members.clear();
    this.projects.clear();

    await this.projects.load();
    await this.tasks.reloadFor();
  }

  /**
   * Asks the backend who this token belongs to.
   *
   * The token already carries a name and an email, so this call looks
   * redundant — but it is the request that provisions the local account on a
   * first sign-in. Reading the identity out of the token instead would leave a
   * new user with no row, no project, and an empty application.
   */
  private async loadProfile(): Promise<void> {
    try {
      const profile = await firstValueFrom(
        this.http.get<Profile>(`${API_BASE_URL}/me`)
      );
      this.session.setProfile(profile);
    } catch {
      // Leaves the header without a name. Every other view reports its own
      // failures; duplicating that here would show two errors for one outage.
    }
  }
}