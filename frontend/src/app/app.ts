import { Component, effect, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { apiBaseUrl } from './core/api.config';
import { Profile, SessionService } from './core/session.service';
import { runtimeConfig } from './core/runtime-config';
import { MemberService } from './core/member.service';
import { ProjectService } from './core/project.service';
import { TaskService } from './core/task.service';
import { MembersPanel } from './features/members/members-panel/members-panel';
import { ProjectPanel } from './features/projects/project-panel/project-panel';
import { HistoryPanel } from './features/history/history-panel/history-panel';
import { AuditService } from './core/audit.service';
import { Project } from './models/project.model';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MembersPanel, ProjectPanel, HistoryPanel],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {

  readonly session = inject(SessionService);
  readonly projects = inject(ProjectService);

  private readonly tasks = inject(TaskService);
  readonly members = inject(MemberService);
  private readonly audit = inject(AuditService);
  private readonly http = inject(HttpClient);

  /**
   * Whether to stand a warning at the bottom of the rail.
   *
   * A getter rather than a field, for the reason set out in ProjectService:
   * config.json is fetched by the app initializer, and a value read while a
   * class is being constructed can be the default that was in force before
   * the fetch returned. This component is built after the initializer has
   * finished, so a field would work today, which is exactly what makes it
   * worth not writing.
   */
  protected get isDemo(): boolean {
    return runtimeConfig().demo;
  }

  /**
   * Whether the notice on the public instance's sign-in screen has been
   * acknowledged. Nothing but the button depends on it: it is there so
   * that nobody signs in to a shared sandbox without having been told it
   * is one, not to keep anybody out.
   */
  protected readonly consented = signal(false);

  /** The membership panel, which opens over the current view rather than replacing it. */
  readonly membersOpen = signal(false);

  readonly projectPanelOpen = signal(false);
  readonly historyOpen = signal(false);

  /** null while creating, the current project while renaming. */
  readonly editingProject = signal<Project | null>(null);

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
  /**
   * Handles both switching project and the two actions sharing the control.
   *
   * The actions live in the picker because that is where somebody already goes
   * to think about which project they are in. Choosing one leaves the select
   * showing "New project…" as if it were the current project, so the control
   * is put back before the panel opens.
   */
  onProjectChange(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const choice = select.value;

    if (choice === 'new' || choice === 'edit' || choice === 'leave') {
      select.value = String(this.projects.currentId());

      if (choice === 'leave') {
        void this.leaveProject();
        return;
      }

      this.editingProject.set(choice === 'edit' ? this.projects.current() : null);
      this.projectPanelOpen.set(true);
      return;
    }

    const id = Number(choice);
    this.projects.select(id);

    // The roster belonged to the project just left. Dropping it rather than
    // refetching keeps the request for whoever actually opens the panel.
    this.members.clear();
    this.audit.clear();
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

  /**
   * Leaves the current project.
   *
   * Confirmed, because it is not undoable from this side: getting back in
   * needs somebody who is still in it to invite you. The refusal that matters
   * — the last owner walking away and leaving a project nobody can administer
   * — comes from the server, and its wording is what the reader sees.
   */
  private async leaveProject(): Promise<void> {
    const project = this.projects.current();
    const me = this.session.profile();
    if (!project || !me) return;

    const confirmed = confirm(
      `Leave "${project.name}"? You will lose access until somebody invites you back.`
    );
    if (!confirmed) return;

    try {
      await this.members.leave(project.id, me.id);
      await this.onLeftProject();
    } catch (err) {
      this.leaveError.set((err as Error).message);
    }
  }

  /**
   * Why leaving was refused.
   *
   * Held on the shell rather than in a panel: the action is taken from the
   * rail, and there is no panel open to put the message in.
   */
  readonly leaveError = signal<string | null>(null);

  openHistory(): void {
    this.historyOpen.set(true);
  }

  closeHistory(): void {
    this.historyOpen.set(false);
  }

  openNewProject(): void {
    this.editingProject.set(null);
    this.projectPanelOpen.set(true);
  }

  /**
   * Closing after a create or a rename.
   *
   * The service has already updated the list in place — and, for a create,
   * switched to the new project — so the only thing left is to reload what
   * hangs off it. Reloading tasks unconditionally costs one request and is
   * cheaper than working out whether the current project changed.
   */
  closeProjectPanel(): void {
    this.projectPanelOpen.set(false);
    this.editingProject.set(null);
    this.members.clear();
    void this.tasks.reloadFor();
  }

  /**
   * The project just deleted may have been the one on screen.
   *
   * The service has already settled on whatever is left, including nothing at
   * all — a person can delete their way down to no projects, and the rail has
   * to keep offering the way back.
   */
  async onProjectDeleted(): Promise<void> {
    this.projectPanelOpen.set(false);
    this.editingProject.set(null);
    this.membersOpen.set(false);
    this.members.clear();

    await this.tasks.reloadFor();
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
        this.http.get<Profile>(`${apiBaseUrl()}/me`)
      );
      this.session.setProfile(profile);
    } catch {
      // Leaves the header without a name. Every other view reports its own
      // failures; duplicating that here would show two errors for one outage.
    }
  }
}