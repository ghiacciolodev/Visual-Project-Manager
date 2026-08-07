import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideAuth } from 'angular-auth-oidc-client';
import { firstValueFrom } from 'rxjs';

import { routes } from './app.routes';
import { authConfig } from './core/auth.config';
import { authInterceptor } from './core/auth.interceptor';
import { runtimeConfig$ } from './core/runtime-config';
import { SessionService } from './core/session.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),

    // withFetch() uses the Fetch API instead of XMLHttpRequest: the modern
    // transport, and the one that works under server-side rendering should
    // the project ever need it.
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),

    provideAuth(authConfig),

    // Runs to completion before the router resolves its first route, and that
    // ordering is the whole point.
    //
    // Started from a component instead, this races the router: the guard reads
    // isAuthenticated$ while it is still false, calls authorize(), and that
    // generates a fresh state and code_verifier — overwriting the pair the
    // in-flight callback is about to be validated against. The exchange then
    // fails on a state mismatch, silently, leaving an authorization code
    // sitting unused in the address bar.
    //
    // config.json is awaited first. The OIDC library waits for its own loader
    // without help, but everything else reads apiBaseUrl() synchronously, and
    // a service constructed before the fetch resolves would hold the
    // development default for the life of the page.
    provideAppInitializer(() => {
      const session = inject(SessionService);
      return firstValueFrom(runtimeConfig$).then(() => session.check());
    }),
  ],
};