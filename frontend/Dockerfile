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

EXPOSE 80