FROM node:22-alpine AS build

WORKDIR /build

# Same caching argument as the backend: dependencies first, sources second.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build


# nginx rather than "ng serve": the development server is a development tool —
# unoptimised, single-threaded, and explicitly not meant to face anybody.
FROM nginx:alpine

# The application builder emits the browser bundle under dist/<project>/browser.
COPY --from=build /build/dist/frontend/browser /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Deliberately not in conf.d/. That directory is globbed into the http block,
# so a headers file there would be applied once implicitly and twice more by
# the includes below it, and nginx would send every header three times.
#
# A template, because connect-src has to name this deployment's API and
# Keycloak. The entrypoint script below fills it in and writes config.json from
# the same values, so the policy and the application agree by construction.
COPY security-headers.conf.template /etc/nginx/vpm-security-headers.conf.template

# nginx's own entrypoint runs everything in this directory before starting the
# server, so there is no ENTRYPOINT to override and no way to skip it.
COPY docker-entrypoint.d/40-vpm-runtime-config.sh /docker-entrypoint.d/40-vpm-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/40-vpm-runtime-config.sh

EXPOSE 80