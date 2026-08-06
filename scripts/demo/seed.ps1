<#
.SYNOPSIS
    Fills a local instance with the demo project used in the README.

.DESCRIPTION
    Two halves that have to agree with each other:

      1. four accounts in Keycloak, which is where identity actually
         lives, and
      2. the plan itself in the application database, linked to those
         accounts by the subject id Keycloak minted for each one.

    The link is the whole point of doing it in one script. Seeding the
    database alone would produce four people nobody can sign in as;
    creating the accounts alone would produce four empty schedules. The
    subject id is what CurrentUser looks a person up by, so it has to be
    the real one, which means the accounts must exist first.

    Nothing here touches data that is not the demo's. The project is
    matched by name and the people by their @northwind.example address,
    so running this against a database you are already using adds a
    project and leaves the rest alone. Run it twice and the second run
    replaces the first.

    Safe to run only against a local development stack. It uses the
    Keycloak bootstrap admin from docker-compose and writes directly to
    the database container.

.EXAMPLE
    pwsh scripts/demo/seed.ps1

.EXAMPLE
    pwsh scripts/demo/seed.ps1 -DemoPassword swordfish
#>

[CmdletBinding()]
param(
    [string] $KeycloakUrl   = 'http://localhost:8081',
    [string] $Realm         = 'vpm',
    [string] $AdminUser     = 'admin',
    [string] $AdminPassword = 'admin',

    # The password all four demo accounts share. A shared one is the
    # point: this is a sandbox whose credentials are printed in a README,
    # and four different ones would only make it harder to sign in as
    # somebody else and see the same plan through their permissions.
    [string] $DemoPassword  = 'demo',

    [string] $DbContainer   = 'vpm-db',
    [string] $DbUser        = 'vpm',
    [string] $DbName        = 'vpm',

    [string] $ProjectName   = 'Storefront Relaunch'
)

$ErrorActionPreference = 'Stop'

# The cast is fictional and the domain is reserved (RFC 2606), so no
# amount of copying this file can end in mail to a real address.
$people = @(
    @{ Key = 'harriet'; Username = 'harriet'; First = 'Harriet'; Last = 'Vance';    Email = 'harriet.vance@northwind.example';   Role = 'owner'  }
    @{ Key = 'marcus';  Username = 'marcus';  First = 'Marcus';  Last = 'Bell';     Email = 'marcus.bell@northwind.example';     Role = 'editor' }
    @{ Key = 'priya';   Username = 'priya';   First = 'Priya';   Last = 'Raghavan'; Email = 'priya.raghavan@northwind.example';  Role = 'editor' }
    @{ Key = 'tom';     Username = 'tom';     First = 'Tom';     Last = 'Iversen';  Email = 'tom.iversen@northwind.example';     Role = 'viewer' }
)

function Get-AdminToken {
    $body = @{
        grant_type = 'password'
        client_id  = 'admin-cli'
        username   = $AdminUser
        password   = $AdminPassword
    }
    try {
        $response = Invoke-RestMethod -Method Post -Body $body `
            -Uri "$KeycloakUrl/realms/master/protocol/openid-connect/token"
    } catch {
        throw "Could not authenticate against Keycloak at $KeycloakUrl. Is the stack up? (docker compose up -d)"
    }
    return $response.access_token
}

<#
    Creates the account, or updates the one already there.

    Idempotent by username rather than by deleting first: a rerun should
    not invalidate the subject id, because the database rows from the
    previous run point at it and half of them are about to be rewritten
    against the new one. Reusing the account keeps the two halves in step
    even if someone runs only one of them.
#>
function Set-DemoUser {
    param($Headers, $Person)

    $existing = Invoke-RestMethod -Headers $Headers `
        -Uri "$KeycloakUrl/admin/realms/$Realm/users?username=$($Person.Username)&exact=true"

    $payload = @{
        username      = $Person.Username
        email         = $Person.Email
        firstName     = $Person.First
        lastName      = $Person.Last
        enabled       = $true
        # Otherwise Keycloak stops the first sign-in with a "verify your
        # email" screen and waits for a message that, in this stack, sits
        # unread in Mailpit.
        emailVerified = $true
    } | ConvertTo-Json

    if ($existing.Count -gt 0) {
        $id = $existing[0].id
        Invoke-RestMethod -Method Put -Headers $Headers -ContentType 'application/json' `
            -Uri "$KeycloakUrl/admin/realms/$Realm/users/$id" -Body $payload | Out-Null
        Write-Host ("  updated {0,-8} {1}" -f $Person.Username, $Person.Email)
    } else {
        Invoke-RestMethod -Method Post -Headers $Headers -ContentType 'application/json' `
            -Uri "$KeycloakUrl/admin/realms/$Realm/users" -Body $payload | Out-Null

        # Read the id back rather than parsing it out of the Location
        # header: one more request, and it cannot be wrong.
        $created = Invoke-RestMethod -Headers $Headers `
            -Uri "$KeycloakUrl/admin/realms/$Realm/users?username=$($Person.Username)&exact=true"
        $id = $created[0].id
        Write-Host ("  created {0,-8} {1}" -f $Person.Username, $Person.Email)
    }

    $credential = @{ type = 'password'; value = $DemoPassword; temporary = $false } | ConvertTo-Json
    Invoke-RestMethod -Method Put -Headers $Headers -ContentType 'application/json' `
        -Uri "$KeycloakUrl/admin/realms/$Realm/users/$id/reset-password" -Body $credential | Out-Null

    return $id
}

# --- Keycloak --------------------------------------------------------

Write-Host "Keycloak $KeycloakUrl (realm: $Realm)"

$headers = @{ Authorization = "Bearer $(Get-AdminToken)" }
$subs = @{}

foreach ($person in $people) {
    $subs[$person.Key] = Set-DemoUser -Headers $headers -Person $person
}

# --- the database ----------------------------------------------------

$sql = Join-Path $PSScriptRoot 'demo-project.sql'
if (-not (Test-Path $sql)) { throw "Missing $sql" }

docker inspect $DbContainer --format '{{.State.Running}}' | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Container $DbContainer is not running. (docker compose up -d)" }

# Copied in rather than piped to stdin. The file is UTF-8 and carries an
# en dash in one of the history entries - piping would hand it to psql in
# whatever the console's code page happens to be, and on a default
# Windows terminal that is not UTF-8.
docker cp $sql "${DbContainer}:/tmp/vpm-demo-project.sql" | Out-Null

Write-Host ""
Write-Host "Database $DbName in $DbContainer"

docker exec -e PGCLIENTENCODING=UTF8 $DbContainer `
    psql -U $DbUser -d $DbName --quiet `
    -v ON_ERROR_STOP=1 `
    -v "project_name=$ProjectName" `
    -v "sub_harriet=$($subs['harriet'])" `
    -v "sub_marcus=$($subs['marcus'])" `
    -v "sub_priya=$($subs['priya'])" `
    -v "sub_tom=$($subs['tom'])" `
    -f /tmp/vpm-demo-project.sql

if ($LASTEXITCODE -ne 0) { throw "psql exited with $LASTEXITCODE - nothing was committed." }

docker exec $DbContainer rm -f /tmp/vpm-demo-project.sql | Out-Null

Write-Host ""
Write-Host "Done. Sign in at http://localhost:4200 as any of:"
foreach ($person in $people) {
    Write-Host ("  {0,-8} / {1,-8} {2} ({3})" -f $person.Username, $DemoPassword, "$($person.First) $($person.Last)", $person.Role)
}
Write-Host ""
Write-Host "They all see the same plan. What differs is what the interface lets them do with it."
