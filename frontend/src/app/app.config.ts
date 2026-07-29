import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes),

    // withFetch() uses the Fetch API instead of XMLHttpRequest: it is the
    // modern transport and the one that works under server-side rendering
    // should the project ever need it.
    provideHttpClient(withFetch()),
  ],
};