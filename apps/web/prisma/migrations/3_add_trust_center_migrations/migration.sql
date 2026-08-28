-- Trust Center AI Migration: import an existing/external trust center by crawling
-- it with a Browserbase session, then copying its documents and content into this
-- trust center. The pause/resume (NDA + document release) is driven from the
-- dashboard, so the job state lives here in the web DB.
CREATE TABLE "TrustCenterMigration" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "requesterName" TEXT,
    "requesterEmail" TEXT,
    "requesterCompany" TEXT,
    "accessNotes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "statusDetail" TEXT,
    "browserbaseSessionId" TEXT,
    "sessionReplayUrl" TEXT,
    "ndaSigned" BOOLEAN NOT NULL DEFAULT false,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "log" JSONB,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrustCenterMigration_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TrustCenterMigration_vendorId_idx" ON "TrustCenterMigration"("vendorId");
