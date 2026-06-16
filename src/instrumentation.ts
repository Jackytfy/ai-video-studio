/**
 * Next.js instrumentation hook — runs once when a new server runtime starts.
 *
 * This is where we bootstrap the DB-backed render task worker
 * (src/lib/queue/task-runner.ts). Without this hook, the worker was never
 * started, so async render tasks (the default mode of the /render endpoint)
 * stayed PENDING forever — see the stuck-render investigation in June 2026.
 *
 * Guardrails:
 *   - Only run on the Node.js runtime (NOT Edge — `process.env.NEXT_RUNTIME`
 *     is `'nodejs'` for the Node server, `'edge'` for Edge).
 *   - Skip during `next build` so the worker isn't started by the build
 *     process. `register()` itself is not called at build time by Next, but
 *     we double-guard with NEXT_PHASE for safety.
 *   - Allow disabling via env `DISABLE_RENDER_WORKER=1` (useful for tests or
 *     when running a dedicated worker process separately).
 */

// Use a dynamic import inside register() to keep this file side-effect free
// at module load time — instrumentation.ts is evaluated very early.

export async function register(): Promise<void> {
  // Edge runtime can't run our worker (uses better-sqlite3, child_process, etc.)
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Allow opt-out for environments that run a dedicated worker process.
  if (process.env.DISABLE_RENDER_WORKER === "1") {
    console.log("[Instrumentation] Render worker disabled by DISABLE_RENDER_WORKER=1");
    return;
  }

  try {
    const { startRenderWorker } = await import("@/lib/queue/task-runner");
    await startRenderWorker();
    console.log("[Instrumentation] Render task worker started");
  } catch (err) {
    // Log but don't throw — a failed worker shouldn't prevent the server
    // from serving requests. The sync render path (?sync=true) still works.
    console.error("[Instrumentation] Failed to start render task worker:", err);
  }
}
