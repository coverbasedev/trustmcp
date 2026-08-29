-- MCP Audit subsystem: per-org LLM credentials, custom audit clauses, and scans.

-- Per-org LLM provider credentials (API key encrypted at rest).
CREATE TABLE "LlmCredential" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT,
    "model" TEXT NOT NULL,
    "apiKeyEnc" TEXT NOT NULL,
    "baseUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'unverified',

    CONSTRAINT "LlmCredential_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LlmCredential_orgId_idx" ON "LlmCredential"("orgId");

-- Org-defined custom controls merged into every scan.
CREATE TABLE "AuditClause" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dimension" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "weight" DOUBLE PRECISION DEFAULT 0.6,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditClause_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AuditClause_orgId_idx" ON "AuditClause"("orgId");

-- One audit of one MCP server.
CREATE TABLE "McpAuditScan" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "targetUrl" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'http',
    "authKind" TEXT NOT NULL DEFAULT 'none',
    "authDetail" TEXT,
    "authSecretEnc" TEXT,
    "intendedUse" TEXT,
    "integrationPoints" JSONB,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "statusDetail" TEXT,
    "overallScore" INTEGER,
    "grade" TEXT,
    "toolInventory" JSONB,
    "research" JSONB,
    "probes" JSONB,
    "controls" JSONB,
    "scorecard" JSONB,
    "evidence" JSONB,
    "interactions" JSONB,
    "log" JSONB,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedVendorId" TEXT,
    "publishSlug" TEXT,
    "publishedVersion" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "McpAuditScan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "McpAuditScan_publishSlug_key" ON "McpAuditScan"("publishSlug");
CREATE INDEX "McpAuditScan_orgId_idx" ON "McpAuditScan"("orgId");
CREATE INDEX "McpAuditScan_publishedVendorId_idx" ON "McpAuditScan"("publishedVendorId");
