export async function register(): Promise<void> {
  // Only run in Node.js runtime, not edge runtime
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  if (process.env.DISABLE_RENDER_WORKER === "1") {
    console.log(
      "[Instrumentation] Render worker disabled by DISABLE_RENDER_WORKER=1"
    );
    return;
  }
  try {
    const mod = await import("./instrumentation-node");
    await mod.register();
  } catch (err) {
    console.error(
      "[Instrumentation] Failed to start render task worker:",
      err
    );
  }
}
