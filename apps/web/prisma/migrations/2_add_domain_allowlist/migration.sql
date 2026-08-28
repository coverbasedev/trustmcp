-- Domain allowlist (auto-join) for organizations.
ALTER TABLE "Organization"
  ADD COLUMN "allowedDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "domainJoinRole" TEXT NOT NULL DEFAULT 'viewer';

-- New standard role names: invitations now default to the read-only "viewer"
-- role (the legacy "member" value is still treated as a viewer by the app).
ALTER TABLE "Invitation" ALTER COLUMN "role" SET DEFAULT 'viewer';
