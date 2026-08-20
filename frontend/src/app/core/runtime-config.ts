import { LogLevel, OpenIdConfiguration } from 'angular-auth-oidc-client';
import { Observable, from, map, shareReplay } from 'rxjs';

/**
 * The three addresses this application cannot know at build time.
 *
 * Compiled in, they would be three copies of one fact — the API's address,
 * Keycloak's, and the `connect-src` of the content security policy — all
 * saying localhost, which makes a Docker image correct on the machine that
 * built it and nowhere else.
 *
 * They are read from `config.json` at start-up instead, served from the
 * application's own origin. The container writes that file from environment
 * variables before nginx starts, so one image runs anywhere and the policy is
 * generated from the same values the application reads.
 */
export interface RuntimeConfig {
  apiBaseUrl: string;
  keycloak: {
    authority: string;
    clientId: string;
  };

  /**
   * Whether this instance is the public demo.
   *
   * It turns on a standing notice that the accounts are shared, that the data
   * is periodically thrown away, and that nothing private belongs in it. That
   * warning is true of the deployed instance and false of a laptop, so it is
   * configuration rather than a constant: shown always, it would be a lie on
   * every development machine and would follow the application into its own
   * screenshots.
   */
  demo: boolean;
}

/**
 * What to use when nothing has been loaded.
 *
 * The values a developer running `npm start` would have typed. Having them
 * means the unit tests need no fetch and no fixture: they exercise real URLs
 * without a network call that would have to be mocked in ten specs to assert
 * nothing.
 */
const DEFAULTS: RuntimeConfig = {
  apiBaseUrl: 'http://localhost:8080/api/v1',
  keycloak: {
    authority: 'http://localhost:8081/realms/vpm',
    clientId: 'vpm-frontend',
  },
  demo: false,
};

let current: RuntimeConfig = DEFAULTS;

/**
 * The configuration in force. Never null: before the fetch resolves, and in
 * tests, it is the development default.
 */
export function runtimeConfig(): RuntimeConfig {
  return current;
}

/**
 * Fetched once and shared.
 *
 * Two things need it and they need it at different moments: the app
 * initializer, so that `runtimeConfig()` is correct before any service is
 * constructed, and the OIDC library's config loader, which takes an
 * observable and subscribes when it is ready. shareReplay means one request
 * rather than two, whichever asks first.
 *
 * Plain fetch rather than HttpClient, because the interceptor that HttpClient
 * would run is the one asking where the API is.
 */
export const runtimeConfig$: Observable<RuntimeConfig> = from(
  fetch('config.json', { cache: 'no-store' })
    .then(response => {
      if (!response.ok) {
        throw new Error(`config.json responded ${response.status}`);
      }
      return response.json() as Promise<RuntimeConfig>;
    })
    .then(loaded => {
      current = { ...DEFAULTS, ...loaded, keycloak: { ...DEFAULTS.keycloak, ...loaded.keycloak } };
      return current;
    })
    .catch(error => {
      // Loud, and then carry on with the defaults. A missing config.json in
      // development is ordinary and the defaults are right; in a container it
      // means the entrypoint did not run, and the symptom would otherwise be
      // an application quietly calling localhost from somebody else's browser.
      console.error(
        '[vpm] Could not read config.json, falling back to development defaults.',
        error
      );
      return current;
    })
).pipe(shareReplay(1));

/** The same, shaped the way angular-auth-oidc-client wants it. */
export const oidcConfig$: Observable<OpenIdConfiguration> = runtimeConfig$.pipe(
  map((config): OpenIdConfiguration => ({
    authority: config.keycloak.authority,
    clientId: config.keycloak.clientId,

    // Where Keycloak sends the browser back. Read from the address the
    // application is actually being served on rather than configured, because
    // it is the one value that cannot be wrong that way.
    redirectUrl: window.location.origin,
    postLogoutRedirectUri: window.location.origin,

    scope: 'openid profile email',
    responseType: 'code',

    // Refreshes the access token in the background, so a fifteen-minute
    // lifetime never interrupts somebody mid-edit.
    silentRenew: true,
    useRefreshToken: true,
    renewTimeBeforeTokenExpiresInSeconds: 60,

    // Tokens live in sessionStorage, which is the library's default and worth
    // being explicit about: they are cleared when the tab closes, are not
    // shared with other tabs, and remain reachable by injected script.
    // SECURITY.md sets out what that does and does not mean.

    logLevel: LogLevel.Warn,
  }))
);
