import { ChangeDetectionStrategy, Component, OnInit, computed, inject, output, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

import { MemberService, MembershipConflict } from '../../../core/member.service';
import { ProjectService } from '../../../core/project.service';
import { Member, ProjectRole } from '../../../models/project.model';
import { Profile, SessionService } from '../../../core/session.service';

const ROLES: ProjectRole[] = ['OWNER', 'EDITOR', 'VIEWER'];

/** What each role is allowed to do, in the panel's own words. */
const ROLE_NOTE: Record<ProjectRole, string> = {
  OWNER: 'Can change the plan and who is in it',
  EDITOR: 'Can change the plan',
  VIEWER: 'Can read the plan',
};

@Component({
  selector: 'app-members-panel',
  imports: [ReactiveFormsModule],
  templateUrl: './members-panel.html',
  styleUrl: './members-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MembersPanel implements OnInit {

  readonly members = inject(MemberService);
  readonly projects = inject(ProjectService);

  readonly close = output<void>();

  /**
   * Emitted when the caller removes their own membership.
   *
   * Separate from close because the consequence is not a closed panel: the
   * project they were reading is no longer theirs, so the shell has to refetch
   * the list and settle on another one. The panel knows the membership ended;
   * it has no business deciding what the application shows next.
   */
  readonly left = output<void>();

  private readonly session = inject(SessionService);
  private readonly fb = inject(FormBuilder);

  readonly roles = ROLES;
  readonly roleNote = ROLE_NOTE;

  readonly inviting = signal(false);

  /**
   * A refusal tied to the member it is about.
   *
   * Kept per row rather than at the top of the panel because the only conflict
   * this screen produces — the last owner stepping down — is an objection to
   * one person's change, and a banner would leave the reader hunting for which
   * select had snapped back.
   */
  readonly conflict = signal<{ userId: number; message: string } | null>(null);

  /** Failure of the invite form, which has nowhere per-row to live. */
  readonly inviteError = signal<string | null>(null);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    role: ['EDITOR' as ProjectRole, [Validators.required]],
  });

  /**
   * Whether this row is the caller's own.
   *
   * Worth marking. Demoting yourself is the one change on this screen you
   * cannot undo — a former owner has no way back into this panel.
   */
  readonly me = computed<Profile | null>(() => this.session.profile());

  /**
   * Owners, for the warning on the last one.
   *
   * Counted here rather than asked of the server: the list is already loaded,
   * and the server will refuse the change regardless. This only decides
   * whether to say so before the click instead of after.
   */
  readonly ownerCount = computed(
    () => this.members.members().filter(m => m.role === 'OWNER').length
  );

  ngOnInit(): void {
    void this.members.load();
  }

  isMe(member: Member): boolean {
    return member.userId === this.me()?.id;
  }

  /** True when demoting or removing this member would leave nobody in charge. */
  isLastOwner(member: Member): boolean {
    return member.role === 'OWNER' && this.ownerCount() <= 1;
  }

  conflictFor(member: Member): string | null {
    const conflict = this.conflict();
    return conflict?.userId === member.userId ? conflict.message : null;
  }

  async onRoleChange(member: Member, event: Event): Promise<void> {
    const role = (event.target as HTMLSelectElement).value as ProjectRole;
    if (role === member.role) return;

    this.conflict.set(null);

    try {
      await this.members.changeRole(member.userId, role);
    } catch (err) {
      // The service has already put the previous role back, so the select
      // returns to where it was and the message explains why it moved.
      this.conflict.set({
        userId: member.userId,
        message: err instanceof MembershipConflict
          ? err.message
          : (err as Error).message,
      });
    }
  }

  async onRemove(member: Member): Promise<void> {
    const who = this.isMe(member) ? 'yourself' : member.displayName;
    if (!confirm(`Remove ${who} from this project?`)) return;

    this.conflict.set(null);

    try {
      await this.members.remove(member.userId);

      // Removing yourself ends your access to this project, so there is
      // nothing left on this panel to come back to.
      if (this.isMe(member)) {
        this.left.emit();
      }
    } catch (err) {
      this.conflict.set({
        userId: member.userId,
        message: err instanceof MembershipConflict
          ? err.message
          : (err as Error).message,
      });
    }
  }

  async onInvite(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.inviting.set(true);
    this.inviteError.set(null);

    const { email, role } = this.form.getRawValue();

    try {
      await this.members.invite(email.trim(), role);
      this.form.reset({ email: '', role: 'EDITOR' });
    } catch (err) {
      this.inviteError.set((err as Error).message);
    } finally {
      this.inviting.set(false);
    }
  }

  hasError(field: string, error: string): boolean {
    const control = this.form.get(field);
    return !!control && control.touched && control.hasError(error);
  }
}
