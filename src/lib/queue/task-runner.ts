/**
 * DB-backed async task queue — no Redis/BullMQ dependency.
 *
 * Workers atomically claim PENDING tasks via `updateMany` and process
 * them inline. Stale PROCESSING tasks (>30 min) are auto-reset on startup.
 *
 * This replaces the sync `await renderProjectInline()` call in the
 * render route, converting it to fire-and-forget with progress tracking
 * via the existing SSE events endpoint.
 */

import { prisma } from "@/lib/db";

// ── Constants ───────────────────────────────────────────────────────

/** How long before a PROCESSING task is considered stale and reset */
const STALE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/** How long the worker sleeps between polling cycles */
const POLL_INTERVAL_MS = 2000;

// ── Types ───────────────────────────────────────────────────────────

export interface TaskRecord {
  id: string;
  projectId: string;
  userId: string;
  status: string;
  renderJobId: string | null;
  config: string | null;
  errorMessage: string | null;
}

// ── Public API ──────────────────────────────────────────────────────

/**
 * Submit a render task to the queue. Returns immediately with the task ID.
 * A worker will pick it up and execute the render pipeline asynchronously.
 */
export async function submitRenderTask(
  projectId: string,
  userId: string
): Promise<{ taskId: string }> {
  const task = await prisma.renderTask.create({
    data: { projectId, userId, status: "PENDING" },
  });
  return { taskId: task.id };
}

/**
 * Atomically claim the next PENDING task.
 * Uses `updateMany` with a subquery-like condition to prevent race
 * conditions between multiple workers.
 *
 * @returns The claimed task, or null if no tasks are pending.
 */
export async function claimNextTask(): Promise<TaskRecord | null> {
  // First, reset any stale PROCESSING tasks
  await prisma.renderTask.updateMany({
    where: {
      status: "PROCESSING",
      claimedAt: { lt: new Date(Date.now() - STALE_TIMEOUT_MS) },
    },
    data: { status: "PENDING", claimedAt: null, errorMessage: "Stale task auto-reset" },
  });

  // Find the highest-priority PENDING task
  const pending = await prisma.renderTask.findFirst({
    where: { status: "PENDING" },
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    select: { id: true, projectId: true, userId: true },
  });

  if (!pending) return null;

  // Atomically claim it
  const result = await prisma.renderTask.updateMany({
    where: { id: pending.id, status: "PENDING" },
    data: { status: "PROCESSING", claimedAt: new Date() },
  });

  if (result.count === 0) {
    // Another worker claimed it first — try again
    return claimNextTask();
  }

  // Re-read to get the full task record
  const task = await prisma.renderTask.findUnique({
    where: { id: pending.id },
    select: {
      id: true, projectId: true, userId: true, status: true,
      renderJobId: true, config: true, errorMessage: true,
    },
  });

  return task;
}

/**
 * Mark a task as completed.
 */
export async function completeTask(taskId: string): Promise<void> {
  await prisma.renderTask.update({
    where: { id: taskId },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}

/**
 * Mark a task as failed.
 */
export async function failTask(taskId: string, errorMessage: string): Promise<void> {
  await prisma.renderTask.update({
    where: { id: taskId },
    data: { status: "FAILED", errorMessage, completedAt: new Date() },
  });
}

/**
 * Get the current pending task count (for monitoring).
 */
export async function getPendingTaskCount(): Promise<number> {
  return prisma.renderTask.count({ where: { status: "PENDING" } });
}

/**
 * Get the current processing task count (for monitoring).
 */
export async function getProcessingTaskCount(): Promise<number> {
  return prisma.renderTask.count({ where: { status: "PROCESSING" } });
}

// ── Worker entry point ──────────────────────────────────────────────

/**
 * Start the task worker loop. Call once at process startup.
 * Does NOT use setInterval — instead recursively schedules with a
 * delay to avoid overlapping claim attempts.
 */
export async function startTaskWorker(
  processTask: (task: TaskRecord) => Promise<void>
): Promise<void> {
  console.log("[TaskWorker] Starting DB-backed worker loop");

  // Reset stale tasks on startup
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
      data: { status: "PENDING", claimedAt: null, errorMessage: "Stale task auto-reset on worker start" },
    });
    console.log(`[TaskWorker] Reset ${staleCount} stale PROCESSING tasks`);
  }

  async function poll(): Promise<void> {
    try {
      const task = await claimNextTask();
      if (task) {
        console.log(`[TaskWorker] Claimed task ${task.id} for project ${task.projectId}`);
        try {
          await processTask(task);
          console.log(`[TaskWorker] Task ${task.id} completed`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[TaskWorker] Task ${task.id} failed:`, msg);
          await failTask(task.id, msg);
        }
      }
    } catch (err) {
      console.error("[TaskWorker] Poll error:", err);
    }

    // Schedule next poll (recursive — avoids setInterval overlap)
    setTimeout(poll, POLL_INTERVAL_MS);
  }

  // Start the loop
  void poll();
}
