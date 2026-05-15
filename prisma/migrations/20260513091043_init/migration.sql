-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "avatarUrl" TEXT,
    "passwordHash" TEXT,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "aiProvider" TEXT NOT NULL DEFAULT 'claude',
    "aiModel" TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
    "ttsProvider" TEXT NOT NULL DEFAULT 'edge-tts',
    "ttsVoice" TEXT NOT NULL DEFAULT 'zh-CN-YunxiNeural',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Project" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'TEXT',
    "metadata" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChatMessage_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Storyboard" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "title" TEXT,
    "totalScenes" INTEGER NOT NULL DEFAULT 0,
    "totalDuration" REAL,
    "totalWords" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'GENERATING',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Storyboard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storyboardId" TEXT NOT NULL,
    "sceneNumber" INTEGER NOT NULL,
    "title" TEXT,
    "sceneType" TEXT NOT NULL DEFAULT 'REAL_FOOTAGE',
    "voiceoverText" TEXT NOT NULL,
    "visualDesc" TEXT NOT NULL,
    "materialQuery" TEXT NOT NULL,
    "subtitleText" TEXT,
    "wordCount" INTEGER,
    "estimatedDuration" REAL,
    "materialId" TEXT,
    "audioUrl" TEXT,
    "audioDuration" REAL,
    "thumbnailUrl" TEXT,
    "renderedUrl" TEXT,
    "transition" TEXT NOT NULL DEFAULT 'CROSS_DISSOLVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Scene_storyboardId_fkey" FOREIGN KEY ("storyboardId") REFERENCES "Storyboard" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Scene_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Material" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "previewUrl" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "duration" REAL,
    "fileSize" INTEGER,
    "format" TEXT,
    "externalId" TEXT,
    "externalSource" TEXT,
    "aiPrompt" TEXT,
    "aiProvider" TEXT,
    "license" TEXT,
    "attribution" TEXT,
    "searchQuery" TEXT,
    "matchScore" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Material_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RenderJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "currentStage" TEXT,
    "progress" REAL NOT NULL DEFAULT 0,
    "stageProgress" TEXT,
    "config" TEXT NOT NULL,
    "outputUrl" TEXT,
    "outputFormat" TEXT,
    "outputSize" INTEGER,
    "outputDuration" REAL,
    "errorMessage" TEXT,
    "errorStage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "estimatedDuration" REAL,
    "elapsedSeconds" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RenderJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RenderJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'MP4_1080P',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "outputUrl" TEXT,
    "fileSize" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "ExportJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Project_userId_status_idx" ON "Project"("userId", "status");

-- CreateIndex
CREATE INDEX "Project_updatedAt_idx" ON "Project"("updatedAt");

-- CreateIndex
CREATE INDEX "ChatMessage_projectId_createdAt_idx" ON "ChatMessage"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Storyboard_projectId_key" ON "Storyboard"("projectId");

-- CreateIndex
CREATE INDEX "Scene_storyboardId_sceneNumber_idx" ON "Scene"("storyboardId", "sceneNumber");

-- CreateIndex
CREATE INDEX "Material_projectId_idx" ON "Material"("projectId");

-- CreateIndex
CREATE INDEX "Material_externalId_idx" ON "Material"("externalId");

-- CreateIndex
CREATE INDEX "RenderJob_userId_status_idx" ON "RenderJob"("userId", "status");

-- CreateIndex
CREATE INDEX "RenderJob_projectId_idx" ON "RenderJob"("projectId");

-- CreateIndex
CREATE INDEX "RenderJob_status_priority_createdAt_idx" ON "RenderJob"("status", "priority", "createdAt");
