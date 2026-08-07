-- =====================================================================
-- V5: one address, one row, whatever case it arrives in
--
-- Invitations store the address lower-cased. Provisioning read the claim
-- as it came, and the two agreed only because Keycloak lower-cases
-- addresses of its own accord: an identity provider that did not would
-- have produced a second row for Ada@example.com and left the
-- invitation, sent to ada@example.com, permanently unclaimed.
--
-- CurrentUser now normalises too, which fixes the application. This
-- fixes the schema, so the guarantee does not depend on remembering.
-- The plain UNIQUE on email stays: it is what the FK and the lookups
-- use, and this index sits beside it.
-- =====================================================================

-- Nothing to fold in an existing database, since every address in it
-- came through Keycloak already lower-cased. Written as an UPDATE
-- anyway: a restore from a dump taken elsewhere is exactly the case
-- where that assumption stops holding, and the index below would fail
-- to build rather than fail quietly.
UPDATE users SET email = lower(email) WHERE email <> lower(email);

CREATE UNIQUE INDEX idx_users_email_lower ON users (lower(email));
