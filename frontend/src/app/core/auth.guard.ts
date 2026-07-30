import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';

import { SessionService } from './session.service';

/**
 * Blocks routes for signed-out visitors.
 *
 * Deliberately does not call authorize(). The application shows a sign-in
 * screen and lets the person choose when to leave for Keycloak; a guard that
 * redirected on its own would make that screen unreachable, and would fire
 * during startup when the answer is not yet known.
 *
 * A convenience, not a security boundary either way: this only decides what
 * the browser renders, and anyone can edit that. Enforcement is the backend
 * refusing every request without a valid token, which it already does by
 * default for every endpoint but health.
 */
export const authGuard: CanActivateFn = () => {
  return inject(SessionService).authenticated();
};