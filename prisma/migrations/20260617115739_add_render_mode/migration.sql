-- AlterTable
ALTER TABLE "Scene" ADD COLUMN "renderWarning" TEXT;

-- CreateTable
CREATE TABLE "AICache" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cacheKey" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "RenderTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "renderJobId" TEXT,
    "config" TEXT,
    "errorMessage" TEXT,
    "claimedAt" DATETIME,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "sourceText" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'TEXT',
    "audioUploadUrl" TEXT,
    "aspectRatio" TEXT NOT NULL DEFAULT 'W_16_9',
    "contentStyle" TEXT NOT NULL DEFAULT 'KNOWLEDGE',
    "colorTheme" TEXT,
    "aiAnalysis" TEXT,
    "productionPlan" TEXT,
    "materialRequirements" TEXT,
    "renderMode" TEXT NOT NULL DEFAULT 'stock',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("aiAnalysis", "aspectRatio", "audioUploadUrl", "colorTheme", "contentStyle", "createdAt", "id", "materialRequirements", "name", "productionPlan", "sourceText", "sourceType", "status", "updatedAt", "userId") SELECT "aiAnalysis", "aspectRatio", "audioUploadUrl", "colorTheme", "contentStyle", "createdAt", "id", "materialRequirements", "name", "productionPlan", "sourceText", "sourceType", "status", "updatedAt", "userId" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE INDEX "Project_userId_status_idx" ON "Project"("userId", "status");
CREATE INDEX "Project_updatedAt_idx" ON "Project"("updatedAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "AICache_cacheKey_key" ON "AICache"("cacheKey");

-- CreateIndex
CREATE INDEX "AICache_cacheKey_idx" ON "AICache"("cacheKey");

-- CreateIndex
CREATE INDEX "AICache_operation_createdAt_idx" ON "AICache"("operation", "createdAt");

-- CreateIndex
CREATE INDEX "AICache_createdAt_idx" ON "AICache"("createdAt");

-- CreateIndex
CREATE INDEX "RenderTask_status_priority_createdAt_idx" ON "RenderTask"("status", "priority", "createdAt");

-- CreateIndex
CREATE INDEX "RenderTask_projectId_idx" ON "RenderTask"("projectId");
