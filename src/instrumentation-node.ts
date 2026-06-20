const STALE_TIMEOUT_MS = 30 * 60 * 1000;

async function resetStaleTasks(): Promise<void> {
  const { prisma } = await import("@/lib/db");
  const staleCount = await prisma.renderTask.count({
    where: {
      status: "PROCESSING",
      claimedAt: { lt: new Date(Date.now() - STALE_TIMEOUT_MS) },
    },
  });
  if (staleCount > 0) {
    await prisma.renderTask.updateMany({
      where: {
        status: "PROCESSING",
        claimedAt: { lt: new Date(Date.now() - STALE_TIMEOUT_MS) },
      },
      data: {
        status: "PENDING",
        claimedAt: null,
        errorMessage: "Stale task auto-reset on worker start",
      },
    });
    console.log(`[TaskWorker] Reset ${staleCount} stale PROCESSING tasks`);
  }
}

export async function register(): Promise<void> {
  await resetStaleTasks();

  const { startTaskWorker } = await import("@/lib/queue/task-runner");
  await startTaskWorker(processRenderTask);
  console.log("[Instrumentation] Render task worker started");
}

async function processRenderTask(task: {
  id: string;
  projectId: string;
  userId: string;
  status: string;
  renderJobId: string | null;
  config: string | null;
  errorMessage: string | null;
}): Promise<void> {
  console.log(
    `[TaskWorker] Processing render task ${task.id} (project ${task.projectId})`
  );

  const { renderProjectInline } = await import("@/lib/render/pipeline");
  const result = await renderProjectInline(task.projectId, task.userId);

  const { prisma } = await import("@/lib/db");
  const { completeTask } = await import("@/lib/queue/task-runner");

  try {
    const latestJob = await prisma.renderJob.findFirst({
      where: { projectId: task.projectId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (latestJob) {
      await prisma.renderTask.update({
        where: { id: task.id },
        data: { renderJobId: latestJob.id },
      });
    }
  } catch (err) {
    console.warn(
      `[TaskWorker] Failed to link RenderJob to task ${task.id}:`,
      err
    );
  }

  await completeTask(task.id);
  console.log(
    `[TaskWorker] Render task ${task.id} completed: ${result.outputUrl} (${result.duration}s)`
  );
}
