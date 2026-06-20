import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastStatus = "";
      let lastProgress = -1;
      let lastStage = "";
      let lastSceneProgress = "";

      const send = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // controller closed
        }
      };

      // Send initial state
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        include: {
          renderJobs: { orderBy: { createdAt: "desc" }, take: 1 },
          storyboard: { include: { scenes: true } },
        },
      });

      if (project) {
        send({
          type: "init",
          status: project.status,
          renderJob: project.renderJobs[0] || null,
          sceneCount: project.storyboard?.scenes.length || 0,
        });
      }

      // Poll for changes
      const interval = setInterval(async () => {
        try {
          const current = await prisma.project.findUnique({
            where: { id: projectId },
            include: {
              renderJobs: { orderBy: { createdAt: "desc" }, take: 1 },
              storyboard: { include: { scenes: { select: { id: true, audioUrl: true, renderedUrl: true } } } },
            },
          });

          if (!current) {
            send({ type: "error", message: "Project not found" });
            clearInterval(interval);
            controller.close();
            return;
          }

          const job = current.renderJobs[0];
          const statusChanged = current.status !== lastStatus;
          const progressChanged = job && (job.progress !== lastProgress || job.currentStage !== lastStage);

          // Calculate scene-level progress
          const scenes = current.storyboard?.scenes || [];
          const ttsDone = scenes.filter((s) => s.audioUrl).length;
          const renderDone = scenes.filter((s) => s.renderedUrl).length;
          const sceneProgressKey = `${ttsDone}/${renderDone}`;

          const sceneProgressChanged = sceneProgressKey !== lastSceneProgress;

          if (statusChanged || progressChanged || sceneProgressChanged) {
            lastStatus = current.status;
            lastProgress = job?.progress ?? -1;
            lastStage = job?.currentStage ?? "";
            lastSceneProgress = sceneProgressKey;

            send({
              type: "update",
              status: current.status,
              renderJob: job
                ? {
                    id: job.id,
                    status: job.status,
                    progress: job.progress,
                    currentStage: job.currentStage,
                    errorMessage: job.errorMessage,  // ✅ 修正为正确的字段名
                    outputUrl: job.outputUrl,
                    stageProgress: job.stageProgress,
                    estimatedDuration: job.estimatedDuration,
                  }
                : null,
              sceneProgress: {
                ttsDone,
                ttsTotal: scenes.length,
                renderDone,
                renderTotal: scenes.length,
              },
            });
          }

          // Stop streaming when project is in a terminal state
          if (["COMPLETED", "FAILED"].includes(current.status) && job && ["COMPLETED", "FAILED"].includes(job.status)) {
            send({ type: "done" });
            clearInterval(interval);
            controller.close();
          }
        } catch {
          // DB error, keep trying
        }
      }, 2000);

      // Cleanup on abort
      _req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        try { controller.close(); } catch {}
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
