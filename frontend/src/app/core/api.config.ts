/**
 * Absolute URL to the backend.
 *
 * An absolute URL rather than a dev proxy on purpose: it exercises the CORS
 * configuration on every request, so a CORS mistake surfaces here in
 * development instead of on the day of the first real deployment.
 */
export const API_BASE_URL = 'http://localhost:8080/api/v1';