import { Injectable, computed, inject, signal } from '@angular/core';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { firstValueFrom } from 'rxjs';

import { ProjectService } from './project.service';

export interface Profile {
  id: number;
  email: string;
  displayName: string;
}

/**
 * The signed-in person, as this application knows them.
 *
 * Wraps OidcSecurityService so that components read signals instead of
 * subscribing to observables, and so that the rest of the app never has to
 * know which OIDC library is in use — replacing it would be this file.
 */
@Injectable({ providedIn: 'root' })
export class SessionService {

  private readonly oidc = inject(OidcSecurityService);

  // Injected so that signing out can clear it. The dependency runs one way —
  // ProjectService knows nothing about sessions — so there is no cycle, and
  // putting the teardown here means it happens however the sign-out was
  // triggered rather than only from the component that has the button.
  private readonly project = inject(ProjectService);

  private readonly _authenticated = signal(false);
  private readonly _profile = signal<Profile | null>(null);
  private readonly _checked = signal(false);

  readonly authenticated = this._authenticated.asReadonly();
  readonly profile = this._profile.asReadonly();

  /** False until the initial callback has been processed. */
  readonly ready = this._checked.asReadonly();

  readonly initials = computed(() => {
    const name = this._profile()?.displayName ?? '';
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase())
      .join('');
  });

  /**
   * Called once from an app initializer, before routing begins.
   *
   * Consumes the authorization code Keycloak appends to the URL after a
   * redirect, or restores an existing session when there is no code. Nothing
   * else in the application may call authorize() until this has settled:
   * doing so would overwrite the state and code_verifier that the in-flight
   * callback is about to be validated against.
   */
  async check(): Promise<void> {
    try {
      const result = await firstValueFrom(this.oidc.checkAuth());
      this._authenticated.set(result.isAuthenticated);
    } catch {
      // A failed callback leaves the app signed out rather than stuck. The
      // sign-in screen is a working state; a half-initialised app is not.
      this._authenticated.set(false);
    } finally {
      this._checked.set(true);
    }
  }

  signIn(): void {
    this.oidc.authorize();
  }

  /**
   * Ends the Keycloak session, not just the local one.
   *
   * Discarding the tokens here would leave the identity provider's session
   * cookie in place: the next sign-in would complete without ever asking for
   * a password, which looks exactly like a logout that did not work.
   */
  signOut(): void {
    this._profile.set(null);
    this._authenticated.set(false);

    // Cached project state belongs to the person who just left. Without this,
    // the next sign-in briefly shows their project name before the new one
    // arrives.
    this.project.clear();

    this.oidc.logoff().subscribe();
  }

  setProfile(profile: Profile): void {
    this._profile.set(profile);
  }
}