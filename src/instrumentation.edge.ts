export async function register(): Promise<void> {
  // No-op for Edge runtime — the render worker requires Node.js APIs
  // (better-sqlite3, child_process, etc.) that are not available here.
}
