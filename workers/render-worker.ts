/**
 * Render Worker — processes render tasks from the DB-backed queue.
 *
 * Start:   npx tsx workers/render-worker.ts
 * Docker:  included as a separate service in docker-compose.yml
 *
 * Uses the same `renderProjectInline()` pipeline as the sync route,
 * but executes it asynchronously with progress tracked via RenderJob
 * and SSE events.
 *
 * This replaces the old `workers/index.ts` which had a completely
 * separate rendering implementation (dual-track problem).
 */

import "dotenv/config"; // optional — for local dev without compose

import { startTaskWorker, type TaskRecord } from "@/lib/queue/task-runner";
import { renderProjectInline } from "@/lib/render/pipeline";

async function main() {
  console.log("[RenderWorker] Starting with DB-backed task queue");

  await startTaskWorker(async (task: TaskRecord) => {
    console.log(`[RenderWorker] Processing task ${task.id} for project ${task.projectId}`);

    await renderProjectInline(task.projectId, task.userId);

    // renderProjectInline updates the RenderJob and project status
    // on success/failure internally. We just need to mark the task
    // as completed here — the task-runner handles the .catch().
    const { completeTask } = await import("@/lib/queue/task-runner");
    await completeTask(task.id);
  });

  console.log("[RenderWorker] Worker loop started, waiting for tasks...");
}

main().catch((err) => {
  console.error("[RenderWorker] Fatal error:", err);
  process.exit(1);
});
