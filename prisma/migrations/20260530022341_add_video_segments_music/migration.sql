-- CreateTable
CREATE TABLE "VideoSegment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "duration" REAL NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "fileSize" INTEGER,
    "format" TEXT DEFAULT 'mp4',
    "trimStart" REAL,
    "trimEnd" REAL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "sceneId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VideoSegment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MusicTrack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "duration" REAL NOT NULL,
    "volume" REAL NOT NULL DEFAULT 0.3,
    "mood" TEXT,
    "genre" TEXT,
    "bpm" INTEGER,
    "isBgm" BOOLEAN NOT NULL DEFAULT true,
    "fadeIn" REAL NOT NULL DEFAULT 1.0,
    "fadeOut" REAL NOT NULL DEFAULT 2.0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MusicTrack_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "VideoSegment_projectId_sortOrder_idx" ON "VideoSegment"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "MusicTrack_projectId_idx" ON "MusicTrack"("projectId");
