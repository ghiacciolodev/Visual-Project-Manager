#!/usr/bin/env bash
#
# The Linux twin of seed.ps1, and rather more than a translation.
#
# On a laptop the seed exists so the screenshots have something to show. On a
# public demo it has a second job: it is the thing that undoes whatever a
# visitor did. The credentials are printed in a README, so anybody can sign in
# as the owner and delete the project, and a demo whose first impression is an
# empty schedule is worse than no demo. Run nightly, this puts the plan back.
#
# While it is there it also re-asserts the realm settings that make the
# instance safe to leave running, because those are equally reachable by
# anyone who finds the administration console password. Configuration that is
# applied once drifts; configuration that is applied every night does not.
#
#   ./seed.sh                              development, localhost, no realm changes
#   PUBLIC_HOST=vpm.example.com ./seed.sh  production, and hardens the realm
#
set -euo pipefail

KEYCLOAK_URL="${KEYCLOAK_URL:-http://localhost:8081}"
REALM="${REALM:-vpm}"
ADMIN_USER="${KEYCLOAK_ADMIN:-admin}"
ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-admin}"
DEMO_PASSWORD="${DEMO_PASSWORD:-demo}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${POSTGRES_USER:-vpm}"
DB_NAME="${POSTGRES_DB:-vpm}"
PROJECT_NAME="${PROJECT_NAME:-Storefront Relaunch}"

# Set to the public hostname to also harden the realm. Absent means a local
# stack, where open registration and a reachable Mailpit are the point.
PUBLIC_HOST="${PUBLIC_HOST:-}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_DIR="$(cd "$HERE/../.." && pwd)"

command -v jq >/dev/null || {
    echo "jq is required (sudo apt install -y jq)" >&2
    exit 1
}

# The cast is fictional and the domain is reserved by RFC 2606, so no amount
# of copying this file can end in mail to a real address.
PEOPLE=(
    "harriet:Harriet:Vance:harriet.vance@northwind.example"
    "marcus:Marcus:Bell:marcus.bell@northwind.example"
    "priya:Priya:Raghavan:priya.raghavan@northwind.example"
    "tom:Tom:Iversen:tom.iversen@northwind.example"
)

api() {
    local method="$1" path="$2"
    shift 2
    curl -sS -X "$method" "$KEYCLOAK_URL$path" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" "$@"
}

echo "Keycloak $KEYCLOAK_URL (realm: $REALM)"

TOKEN=$(curl -sS -X POST \
    "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token" \
    -d grant_type=password -d client_id=admin-cli \
    -d "username=$ADMIN_USER" -d "password=$ADMIN_PASSWORD" \
    | jq -r '.access_token // empty')

[ -n "$TOKEN" ] || {
    echo "Could not authenticate against Keycloak. Is the stack up?" >&2
    exit 1
}

# --- the four accounts -----------------------------------------------------
#
# Idempotent by username rather than by deleting first: a rerun must not
# invalidate the subject id, because the rows about to be written point at it.

declare -A SUBS

for entry in "${PEOPLE[@]}"; do
    IFS=: read -r username first last email <<<"$entry"

    payload=$(jq -n \
        --arg u "$username" --arg e "$email" \
        --arg f "$first" --arg l "$last" \
        '{username:$u, email:$e, firstName:$f, lastName:$l,
          enabled:true,
          # Otherwise the first sign-in stops at a "verify your email" screen
          # and waits for a message that, on a public host, has nowhere to go.
          emailVerified:true}')

    existing=$(api GET "/admin/realms/$REALM/users?username=$username&exact=true")
    id=$(echo "$existing" | jq -r '.[0].id // empty')

    if [ -n "$id" ]; then
        api PUT "/admin/realms/$REALM/users/$id" -d "$payload" >/dev/null
        printf '  updated %-8s %s\n' "$username" "$email"
    else
        api POST "/admin/realms/$REALM/users" -d "$payload" >/dev/null
        id=$(api GET "/admin/realms/$REALM/users?username=$username&exact=true" \
             | jq -r '.[0].id')
        printf '  created %-8s %s\n' "$username" "$email"
    fi

    api PUT "/admin/realms/$REALM/users/$id/reset-password" \
        -d "$(jq -n --arg p "$DEMO_PASSWORD" \
              '{type:"password", value:$p, temporary:false}')" >/dev/null

    SUBS[$username]=$id
done

# --- the realm, when this is a public instance -----------------------------

if [ -n "$PUBLIC_HOST" ]; then
    echo
    echo "Hardening the realm for https://$PUBLIC_HOST"

    api GET "/admin/realms/$REALM" \
        | jq '
            # HTTPS required except from private addresses, which is the
            # Keycloak default and the thing start-dev switches off. Localhost
            # stays exempt, so this is safe on a development realm too.
            .sslRequired          = "external"

            # Closed. Open registration on a public demo hands anybody an
            # account on a server they do not pay for, and with it a project,
            # after which the creation ceilings are the only thing between a
            # visitor and the disk. The four demo accounts are the way in.
            | .registrationAllowed  = false

            # Password reset needs mail that reaches a person. Mailpit is not
            # published here, so the link would be a dead end offered in good
            # faith.
            | .resetPasswordAllowed = false

            # Re-asserted rather than assumed, because these are the settings
            # worth being sure about after a night of strangers clicking.
            | .revokeRefreshToken   = true
            | .refreshTokenMaxReuse = 0
            | .verifyEmail          = true
            | .bruteForceProtected  = true
        ' > /tmp/vpm-realm.json

    api PUT "/admin/realms/$REALM" -d @/tmp/vpm-realm.json >/dev/null
    rm -f /tmp/vpm-realm.json

    client_id=$(api GET "/admin/realms/$REALM/clients?clientId=vpm-frontend" \
                | jq -r '.[0].id')

    api GET "/admin/realms/$REALM/clients/$client_id" \
        | jq --arg origin "https://$PUBLIC_HOST" '
            .redirectUris = [$origin + "/*"]
            | .webOrigins   = [$origin]
            | .attributes["post.logout.redirect.uris"] = $origin + "/*"
            # The password grant stays off. The browser flow with PKCE is the
            # only way in, and this is the setting that drifted once already.
            | .directAccessGrantsEnabled = false
        ' > /tmp/vpm-client.json

    api PUT "/admin/realms/$REALM/clients/$client_id" -d @/tmp/vpm-client.json >/dev/null
    rm -f /tmp/vpm-client.json

    echo "  registration off, password reset off, sslRequired external"
    echo "  redirect URIs and web origins on https://$PUBLIC_HOST"
fi

# --- the plan --------------------------------------------------------------

echo
echo "Database $DB_NAME"

cd "$COMPOSE_DIR"

# Written as an if rather than `[ -n "$X" ] && arr+=(...)`, which survives
# set -e only because a failure before the final && is exempt. It is exempt,
# and it is the kind of line somebody tidies into a bug.
COMPOSE_FILES=(-f docker-compose.yml)
if [ -n "$PUBLIC_HOST" ]; then
    COMPOSE_FILES+=(-f docker-compose.prod.yml)
fi

# Piped rather than copied in. The PowerShell twin copies the file because a
# Windows console is rarely UTF-8; here the locale is, and the en dash in one
# of the history entries survives.
docker compose "${COMPOSE_FILES[@]}" exec -T \
    -e PGCLIENTENCODING=UTF8 "$DB_SERVICE" \
    psql -U "$DB_USER" -d "$DB_NAME" --quiet \
        -v ON_ERROR_STOP=1 \
        -v "project_name=$PROJECT_NAME" \
        -v "sub_harriet=${SUBS[harriet]}" \
        -v "sub_marcus=${SUBS[marcus]}" \
        -v "sub_priya=${SUBS[priya]}" \
        -v "sub_tom=${SUBS[tom]}" \
    < "$HERE/demo-project.sql"

echo
echo "Done. Sign in as any of:"
for entry in "${PEOPLE[@]}"; do
    IFS=: read -r username first last _ <<<"$entry"
    printf '  %-8s / %-8s %s %s\n' "$username" "$DEMO_PASSWORD" "$first" "$last"
done
