# Frontend

Angular 21: standalone components, zoneless change detection, signals.

The project's own documentation is one level up: [what it is and how to
run it](../README.md), and [how it handles identity and
input](../SECURITY.md). What follows is only the commands.

```bash
npm install
npm start                  # http://localhost:4200
npm test -- --watch=false  # Vitest, through Angular's test builder
npm run build              # into dist/
```

Port 4200 is not a preference. It is the only redirect URI the Keycloak
client accepts and the only origin the backend allows through CORS, so the
dev server on any other port gets as far as the sign-in screen and no
further.

`npm start` needs the backend and Keycloak running:

```bash
docker compose up -d db keycloak keycloak-db mailpit
cd ../backend && ./mvnw spring-boot:run
```

## Where things are

```
src/app/
  core/       services (state as signals), the pure geometry, filter and
              export functions, the auth guard and interceptor
  features/   gantt · tasks · members · projects · history
  models/     the shapes the API returns
  styles.scss design tokens, the shared primitives, and the print rules
              that belong to no single component
```

Logic that can live outside a component does. `core/schedule.ts`,
`core/task-filter.ts` and `core/export.ts` are pure functions for exactly
that reason: a function is tested by calling it, and an event handler is
tested by mounting a component and pretending to be a mouse.
