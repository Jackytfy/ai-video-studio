/**
 * Task retry and failure recovery utilities.
 * Provides retry-with-backoff for flaky operations (AI calls, network requests, FFmpeg).
 */

export interface RetryOptions {
  /** Maximum number of attempts (including the first). Default: 3 */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff. Default: 1000 */
  baseDelayMs?: number;
  /** Maximum delay cap in ms. Default: 30000 */
  maxDelayMs?: number;
  /** Jitter factor (0-1). Default: 0.2 */
  jitter?: number;
  /** Predicate to decide if an error is retryable. Default: always retry. */
  isRetryable?: (error: unknown) => boolean;
  /** Called before each retry attempt. */
  onRetry?: (attempt: number, error: unknown) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, "onRetry">> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  jitter: 0.2,
  isRetryable: () => true,
};

/**
 * Execute a function with retry and exponential backoff.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt >= opts.maxAttempts || !opts.isRetryable(error)) {
        throw error;
      }

      // Calculate backoff delay with jitter
      const delay = Math.min(
        opts.baseDelayMs * Math.pow(2, attempt - 1),
        opts.maxDelayMs
      );
      const jitterMs = delay * opts.jitter * Math.random();
      const totalDelay = delay + jitterMs;

      options.onRetry?.(attempt, error);

      await sleep(totalDelay);
    }
  }

  throw lastError;
}

/**
 * Retryable error patterns for common failure scenarios.
 */

/** Network errors (fetch failures, timeouts) */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("econnrefused") ||
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("enotfound") ||
      msg.includes("fetch failed") ||
      msg.includes("network") ||
      msg.includes("timeout") ||
      msg.includes("aborted") ||
      msg.includes("socket hang up")
    );
  }
  return false;
}

/** AI API rate limit / server errors (429, 500-503) */
export function isAIRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      isNetworkError(error) ||
      msg.includes("rate limit") ||
      msg.includes("429") ||
      msg.includes("500") ||
      msg.includes("502") ||
      msg.includes("503") ||
      msg.includes("overloaded") ||
      msg.includes("capacity")
    );
  }
  return false;
}

/** FFmpeg errors that may be transient (file lock, resource busy) */
export function isFFmpegRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("resource busy") ||
      msg.includes("file in use") ||
      msg.includes("permission denied") ||
      msg.includes("enoent") // file not ready yet
    );
  }
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Render job recovery — find stuck/failed jobs and mark them for retry.
 * Call this on server startup or periodically.
 */
export async function recoverStuckJobs(prisma: {
  renderJob: {
    findMany: (args: any) => Promise<any[]>;
    update: (args: any) => Promise<any>;
  };
  project: {
    update: (args: any) => Promise<any>;
  };
}): Promise<number> {
  const STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

  // Find jobs that have been in a transient state for too long
  const stuckJobs = await prisma.renderJob.findMany({
    where: {
      status: { in: ["PREPARING", "TTS_GENERATING", "MATERIALS_LOADING", "COMPOSITING"] },
      startedAt: {
        lt: new Date(Date.now() - STUCK_THRESHOLD_MS),
      },
    },
  });

  for (const job of stuckJobs) {
    await prisma.renderJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorMessage: "Job timed out — auto-recovered",
      },
    });

    await prisma.project.update({
      where: { id: job.projectId },
      data: { status: "FAILED" },
    });
  }

  return stuckJobs.length;
}
