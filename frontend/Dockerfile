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
COPY security-headers.conf /etc/nginx/vpm-security-headers.conf

EXPOSE 80