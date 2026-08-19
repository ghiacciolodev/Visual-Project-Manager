# Deploying the live demo

Written for an Oracle Cloud Always Free ARM instance, which is the shape this
stack fits: four services and two databases want more memory than most free
tiers give, and Keycloak in particular must not be allowed to fall asleep, or
the first person to press "Sign in" waits a minute in front of a blank page.

Nothing here is specific to Oracle beyond the firewall note. Any host with
Docker and a domain works the same way.

---

## The machine

An **Ampere A1 Flex** shape, 4 OCPU and 24 GB, which is the whole Always Free
allowance in one instance and more than this needs. Ubuntu 24.04.

Two things catch people out.

**Capacity.** `Out of host capacity` on the A1 shape is common and is not a
mistake on your part. Retry at another hour, or another availability domain.

**The firewall is in two places.** Opening 80 and 443 in the VCN security list
is only half of it, because the Oracle images ship iptables rules that drop
everything else:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

A domain has to point at the public IP before the first start: Let's Encrypt
does not issue certificates for bare addresses.

---

## The stack

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker
sudo apt install -y jq

git clone https://github.com/ghiacciolodev/Visual-Project-Manager.git
cd Visual-Project-Manager
cp .env.prod.example .env
```

Fill in `.env`. Every secret in it is blank on purpose and the overlay refuses
to start without one, because a default that works is a default nobody
changes:

```bash
openssl rand -base64 32
```

Then:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The first start takes a few minutes: two images build, Keycloak imports the
realm, and Caddy negotiates the certificate. Watch it with
`docker compose logs -f caddy`.

---

## The demo data, and the settings that go with it

```bash
PUBLIC_HOST=vpm.example.com bash scripts/demo/seed.sh
```

`PUBLIC_HOST` is what makes this the production seed rather than the
development one. It does two jobs.

It writes the plan and the four accounts, the same as on a laptop.

And it hardens the realm: `sslRequired` to `external`, registration off,
password reset off, refresh token rotation on, and the client's redirect URIs
and web origins moved to the public domain. Those are applied through the
admin API rather than baked into `realm-export.json`, so the committed realm
stays the one a developer wants on a laptop, with registration open and
Mailpit reachable.

Then install the timer that runs it every night:

```bash
sudo cp scripts/deploy/vpm-reseed.* /etc/systemd/system/
sudo systemctl enable --now vpm-reseed.timer
```

This is not housekeeping, it is what makes the demo safe to leave alone. The
credentials are printed in the README, so anybody can sign in as the owner and
delete the project, and a demo whose first impression is an empty schedule is
worse than no demo. The nightly run puts the plan back, and re-applies the
realm settings while it is there, because configuration applied once drifts
and configuration applied every night does not.

---

## What is different from a laptop

| | Local | Deployed |
|---|---|---|
| Keycloak | `start-dev`, HTTPS not required | `start`, `sslRequired: external` |
| Published ports | five | one, Caddy on 80 and 443 |
| Registration | open | closed, the four demo accounts are the way in |
| Password reset | to Mailpit, readable | off, since the mail would go nowhere |
| Admin console | `localhost:8081` | not routed; reachable over an SSH tunnel |
| Passwords | development values in `.env.example` | required, no defaults |
| Addresses | localhost | the domain, in `config.json` and the CSP |

The admin console is deliberately not routed. Leaving it on the public host
puts one password between a stranger and every account on the instance.

Most administration needs no browser at all, because Keycloak ships its own
command line inside the container:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec keycloak \
  /opt/keycloak/bin/kcadm.sh config credentials \
    --server http://localhost:8080 --realm master \
    --user "$KEYCLOAK_ADMIN" --password "$KEYCLOAK_ADMIN_PASSWORD"

docker compose -f docker-compose.yml -f docker-compose.prod.yml exec keycloak \
  /opt/keycloak/bin/kcadm.sh get realms/vpm --fields sslRequired,registrationAllowed
```

If you want the console itself, publish the port on the loopback interface
only and reach it through a tunnel. Add to a local `docker-compose.admin.yml`:

```yaml
services:
  keycloak:
    ports:
      - "127.0.0.1:8081:8080"
```

then `up -d` with that third file, `ssh -L 8081:localhost:8081 ubuntu@the-host`,
and browse `http://localhost:8081/admin`. Take the file back out afterwards:
bound to `127.0.0.1` it is not reachable from outside the machine, but a port
opened for one afternoon is a port somebody forgets.

---

## Afterwards

Check the certificate and the headers arrived:

```bash
curl -sI https://vpm.example.com/ | grep -iE 'strict-transport|content-security|x-frame'
```

And that the API is up behind it:

```bash
curl -s https://vpm.example.com/api/v1/me    # 401 without a token is the right answer
```

A 401 there is success: it means the request reached Spring Security through
Caddy, and that the endpoint is not open.

Updating later is `git pull`, then the same `up -d` with `--build`. The
volumes survive, so the database and the certificate do not have to be
negotiated again.
