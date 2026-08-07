import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { OidcSecurityService } from 'angular-auth-oidc-client';
import { catchError, switchMap, take, throwError } from 'rxjs';

import { apiBaseUrl } from './api.config';

/**
 * Attaches the access token to API calls.
 *
 * Scoped to this application's own API by URL. An interceptor that adds the
 * header to every outgoing request would also send it to Keycloak's token
 * endpoint and to any third-party service the app later talks to — handing a
 * credential to hosts that have no business holding one.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {

  if (!req.url.startsWith(apiBaseUrl())) {
    return next(req);
  }

  const oidc = inject(OidcSecurityService);

  return oidc.getAccessToken().pipe(
    take(1),
    switchMap(token => {
      const authorised = token
        ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })
        : req;

      return next(authorised).pipe(
        catchError((error: HttpErrorResponse) => {
          // A 401 here means the token was rejected despite silent renew —
          // the session has genuinely ended. Sending the user back to
          // Keycloak is better than showing an error they cannot act on.
          if (error.status === 401) {
            oidc.authorize();
          }
          return throwError(() => error);
        })
      );
    })
  );
};