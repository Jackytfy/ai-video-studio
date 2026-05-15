import { prisma } from "@/lib/db";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const connection = new IORedis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});

const renderQueue = new Queue("render", { connection });

export interface RenderConfig {
  width: number;
  height: number;
  fps: number;
  format: string;
}

const ASPECT_CONFIGS: Record<string, RenderConfig> = {
  W_16_9: { width: 1920, height: 1080, fps: 30, format: "mp4" },
  W_9_16: { width: 1080, height: 1920, fps: 30, format: "mp4" },
  W_1_1: { width: 1080, height: 1080, fps: 30, format: "mp4" },
};

export function getRenderConfig(aspectRatio: string): RenderConfig {
  return ASPECT_CONFIGS[aspectRatio] || ASPECT_CONFIGS.W_16_9;
}

export async function createRenderJob(
  projectId: string,
  userId: string
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      storyboard: {
        include: {
          scenes: {
            where: { materialId: { not: null } },
            orderBy: { sceneNumber: "asc" },
          },
        },
      },
    },
  });

  if (!project) throw new Error("Project not found");
  if (!project.storyboard) throw new Error("Storyboard not found");

  const config = getRenderConfig(project.aspectRatio);

  const renderJob = await prisma.renderJob.create({
    data: {
      projectId,
      userId,
      status: "QUEUED",
      config: JSON.stringify({
        ...config,
        sceneCount: project.storyboard.scenes.length,
      }),
    },
  });

  await renderQueue.add("render-project", {
    jobId: renderJob.id,
    projectId,
    userId,
    config,
    scenes: project.storyboard.scenes.map((s) => ({
      id: s.id,
      sceneNumber: s.sceneNumber,
      voiceoverText: s.voiceoverText,
      visualDesc: s.visualDesc,
      audioUrl: s.audioUrl,
      materialId: s.materialId,
      transition: s.transition,
    })),
  }, {
    priority: 1,
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  });

  return renderJob;
}
