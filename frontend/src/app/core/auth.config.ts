import { LogLevel, PassedInitialConfig } from 'angular-auth-oidc-client';

/**
 * OpenID Connect settings for the Keycloak realm.
 *
 * Authorization Code with PKCE, and no client secret: this application runs in
 * a browser, where a secret in the bundle is readable by anyone who opens the
 * developer tools. PKCE replaces it with a per-request proof that only the
 * initiating tab can produce.
 */
export const authConfig: PassedInitialConfig = {
  config: {
    authority: 'http://localhost:8081/realms/vpm',
    clientId: 'vpm-frontend',

    // Keycloak redirects back here after sign-in; the library reads the code
    // out of the URL and exchanges it for tokens.
    redirectUrl: window.location.origin,
    postLogoutRedirectUri: window.location.origin,

    scope: 'openid profile email',
    responseType: 'code',

    // Refreshes the access token in the background, so a fifteen-minute
    // lifetime never interrupts someone mid-edit.
    silentRenew: true,
    useRefreshToken: true,
    renewTimeBeforeTokenExpiresInSeconds: 60,

    // Tokens live in sessionStorage, which is the library's default and worth
    // being explicit about: they are cleared when the tab closes, are not
    // shared with other tabs, and remain reachable by injected script. The
    // mitigations here are a short access-token lifetime and Angular's own
    // escaping; the structural fix is a backend-for-frontend holding the
    // refresh token in an httpOnly cookie, which is out of scope for this
    // project and named in SECURITY.md as such.

    logLevel: LogLevel.Warn,
  },
};