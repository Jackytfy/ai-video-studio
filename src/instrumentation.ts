export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.DISABLE_RENDER_WORKER === "1") {
      console.log(
        "[Instrumentation] Render worker disabled by DISABLE_RENDER_WORKER=1"
      );
      return;
    }
    try {
      await import("./instrumentation-node");
    } catch (err) {
      console.error(
        "[Instrumentation] Failed to start render task worker:",
        err
      );
    }
  }
}
