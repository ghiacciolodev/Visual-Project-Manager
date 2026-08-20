import {
  PassedInitialConfig,
  StsConfigHttpLoader,
  StsConfigLoader,
} from 'angular-auth-oidc-client';

import { oidcConfig$ } from './runtime-config';

/**
 * OpenID Connect settings for the Keycloak realm.
 *
 * Authorization Code with PKCE, and no client secret: this application runs in
 * a browser, where a secret in the bundle is readable by anyone who opens the
 * developer tools. PKCE replaces it with a per-request proof that only the
 * initiating tab can produce.
 *
 * Loaded rather than declared. A literal here with Keycloak's address written
 * into it compiles localhost into the image and makes the build correct on
 * exactly one machine. StsConfigHttpLoader takes an observable and the library
 * waits for it, so the values come from config.json alongside the API's
 * address, in one file the container writes at start-up.
 *
 * The shape of the configuration lives in runtime-config.ts, next to the fetch
 * that feeds it, so there is one place to read to know what the application
 * needs to be told about its surroundings.
 */
export const authConfig: PassedInitialConfig = {
  loader: {
    provide: StsConfigLoader,
    useFactory: () => new StsConfigHttpLoader(oidcConfig$),
  },
};
