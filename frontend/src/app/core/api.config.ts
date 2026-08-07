import { runtimeConfig } from './runtime-config';

/**
 * Absolute URL to the backend.
 *
 * Absolute rather than a dev proxy on purpose: it exercises the CORS
 * configuration on every request, so a CORS mistake surfaces in development
 * instead of on the day of the first real deployment.
 *
 * A function rather than the constant it used to be, because the value now
 * arrives with config.json at start-up. Everything that calls it does so from
 * inside a service method or a service constructor, both of which run well
 * after the app initializer has finished.
 */
export function apiBaseUrl(): string {
  return runtimeConfig().apiBaseUrl;
}
