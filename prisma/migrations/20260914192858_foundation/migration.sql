-- CreateTable
CREATE TABLE "GmailAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT,
    "scope" TEXT NOT NULL,
    "connectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnectedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OAuthAttempt" (
    "stateHash" TEXT NOT NULL PRIMARY KEY,
    "encryptedVerifier" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EmailSource" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "accountEmail" TEXT NOT NULL,
    "gmailQuery" TEXT NOT NULL,
    "after" TEXT,
    "before" TEXT,
    "acceptedSendersJson" TEXT NOT NULL,
    "subjectPatternsJson" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SourceMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gmailMessageId" TEXT NOT NULL,
    "accountEmail" TEXT NOT NULL,
    "gmailThreadId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL,
    "sentAt" DATETIME,
    "fromAddress" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "hasPdfAttachment" BOOLEAN NOT NULL,
    "importStatus" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "importedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "warningsJson" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "SourceMessage_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "EmailSource" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sourceMessageId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "category" TEXT,
    "reportReference" TEXT,
    "publishedAt" DATETIME,
    "availableAt" DATETIME NOT NULL,
    "companyName" TEXT,
    "symbol" TEXT,
    "bseCode" TEXT,
    "action" TEXT,
    "recommendedPrice" REAL,
    "entryLow" REAL,
    "entryHigh" REAL,
    "primaryTarget" REAL,
    "stopLoss" REAL,
    "statedUpsidePercent" REAL,
    "horizon" TEXT,
    "rationale" TEXT,
    "status" TEXT NOT NULL,
    "extractionConfidence" REAL NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    "approvedAt" DATETIME,
    "parserVersion" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "manualFieldsJson" TEXT NOT NULL DEFAULT '[]',
    "warningsJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Recommendation_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "SourceMessage" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecommendationTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recommendationId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "price" REAL NOT NULL,
    "label" TEXT,
    CONSTRAINT "RecommendationTarget_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FieldEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recommendationId" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "extractedValue" TEXT NOT NULL,
    "evidenceSnippet" TEXT NOT NULL,
    "confidence" REAL NOT NULL,
    "extractionMethod" TEXT NOT NULL,
    CONSTRAINT "FieldEvidence_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecommendationEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recommendationId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "effectiveAt" DATETIME NOT NULL,
    "relatedRecommendationId" TEXT,
    "previousValuesJson" TEXT NOT NULL,
    "newValuesJson" TEXT NOT NULL,
    "matchConfidence" REAL NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    CONSTRAINT "RecommendationEvent_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RecommendationVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recommendationId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshotJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecommendationVersion_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "Recommendation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "action" TEXT NOT NULL,
    "entityId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "GmailAccount_email_key" ON "GmailAccount"("email");

-- CreateIndex
CREATE INDEX "SourceMessage_sourceId_importStatus_idx" ON "SourceMessage"("sourceId", "importStatus");

-- CreateIndex
CREATE UNIQUE INDEX "SourceMessage_accountEmail_gmailMessageId_key" ON "SourceMessage"("accountEmail", "gmailMessageId");

-- CreateIndex
CREATE INDEX "Recommendation_reviewStatus_availableAt_idx" ON "Recommendation"("reviewStatus", "availableAt");

-- CreateIndex
CREATE INDEX "Recommendation_symbol_provider_category_idx" ON "Recommendation"("symbol", "provider", "category");

-- CreateIndex
CREATE UNIQUE INDEX "Recommendation_sourceMessageId_ordinal_key" ON "Recommendation"("sourceMessageId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationTarget_recommendationId_sequence_key" ON "RecommendationTarget"("recommendationId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationVersion_recommendationId_revision_key" ON "RecommendationVersion"("recommendationId", "revision");
