#!/bin/sh
# Writes the two files that must know where this deployment lives.
#
# The image is built once and run anywhere, so neither the API's address nor
# Keycloak's can be compiled into it. Both used to be, along with the same pair
# again inside the content security policy, which meant the bundle was correct
# on the machine that built it and nowhere else.
#
# nginx's own entrypoint runs everything in /docker-entrypoint.d before
# starting the server, so this needs no ENTRYPOINT of its own and cannot be
# forgotten.
set -eu

API_BASE_URL="${API_BASE_URL:-http://localhost:8080/api/v1}"
KEYCLOAK_AUTHORITY="${KEYCLOAK_AUTHORITY:-http://localhost:8081/realms/vpm}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-vpm-frontend}"

# --- what the application reads at start-up --------------------------------

cat > /usr/share/nginx/html/config.json <<JSON
{
  "apiBaseUrl": "${API_BASE_URL}",
  "keycloak": {
    "authority": "${KEYCLOAK_AUTHORITY}",
    "clientId": "${KEYCLOAK_CLIENT_ID}"
  }
}
JSON

# --- and what the browser is allowed to talk to ----------------------------
#
# Derived from the same two values rather than configured separately. A policy
# and an application that disagree about where the API is fail in the least
# helpful way available: every request blocked, nothing in the server log, and
# the explanation only in the browser console.
#
# Origins only. connect-src matches by origin, and the API's value carries a
# path (/api/v1) that would never match anything if it were passed through.
origin_of() {
    echo "$1" | sed -E 's#^([a-zA-Z][a-zA-Z0-9+.-]*://[^/]+).*#\1#'
}

CSP_CONNECT_SRC="'self' $(origin_of "$API_BASE_URL") $(origin_of "$KEYCLOAK_AUTHORITY")"
export CSP_CONNECT_SRC

envsubst '${CSP_CONNECT_SRC}' \
    < /etc/nginx/vpm-security-headers.conf.template \
    > /etc/nginx/vpm-security-headers.conf

echo "[vpm] API ${API_BASE_URL}"
echo "[vpm] Keycloak ${KEYCLOAK_AUTHORITY}"
echo "[vpm] connect-src ${CSP_CONNECT_SRC}"
