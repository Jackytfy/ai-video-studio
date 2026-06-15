/**
 * Simple in-memory rate limiter.
 *
 * For production, consider replacing with `rate-limiter-flexible` backed by
 * Redis for distributed deployments. This implementation is sufficient for
 * single-instance SQLite deployments.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.resetAt <= now) {
        store.delete(key);
      }
    }
    // Stop the timer if the store is empty
    if (store.size === 0 && cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
  }, CLEANUP_INTERVAL);
  // Allow process to exit even if timer is active
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    (cleanupTimer as NodeJS.Timeout).unref();
  }
}

export interface RateLimitConfig {
  /** Maximum number of requests within the window. */
  maxRequests: number;
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Key prefix for this rate limit (e.g. "ai-calls"). */
  prefix?: string;
}

export interface RateLimitResult {
  /** Whether the request is allowed. */
  allowed: boolean;
  /** Number of remaining requests in the current window. */
  remaining: number;
  /** Unix timestamp (ms) when the window resets. */
  resetAt: number;
  /** Total limit for this window. */
  limit: number;
}

/**
 * Check if a request identified by `identifier` is within the rate limit.
 *
 * @example
 * ```ts
 * const result = checkRateLimit("user-123", { maxRequests: 100, windowMs: 86_400_000 });
 * if (!result.allowed) {
 *   return NextResponse.json({ error: "Too many requests" }, { status: 429 });
 * }
 * ```
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): RateLimitResult {
  const { maxRequests, windowMs, prefix = "rate" } = config;
  const key = `${prefix}:${identifier}`;
  const now = Date.now();

  ensureCleanup();

  const existing = store.get(key);

  // No entry or window expired → start fresh
  if (!existing || existing.resetAt <= now) {
    const entry: RateLimitEntry = {
      count: 1,
      resetAt: now + windowMs,
    };
    store.set(key, entry);
    return {
      allowed: true,
      remaining: maxRequests - 1,
      resetAt: entry.resetAt,
      limit: maxRequests,
    };
  }

  // Within window
  existing.count++;

  if (existing.count > maxRequests) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.resetAt,
      limit: maxRequests,
    };
  }

  return {
    allowed: true,
    remaining: maxRequests - existing.count,
    resetAt: existing.resetAt,
    limit: maxRequests,
  };
}

// --- Pre-configured limits ---

/** AI calls: 100 per user per day */
export const AI_CALLS_LIMIT: RateLimitConfig = {
  maxRequests: 100,
  windowMs: 24 * 60 * 60 * 1000,
  prefix: "ai-calls",
};

/** Render triggers: 10 per user per hour */
export const RENDER_LIMIT: RateLimitConfig = {
  maxRequests: 10,
  windowMs: 60 * 60 * 1000,
  prefix: "render",
};

/** General API: 600 per IP per minute */
export const GENERAL_API_LIMIT: RateLimitConfig = {
  maxRequests: 600,
  windowMs: 60 * 1000,
  prefix: "api",
};

/** File upload: 20 per user per hour */
export const UPLOAD_LIMIT: RateLimitConfig = {
  maxRequests: 20,
  windowMs: 60 * 60 * 1000,
  prefix: "upload",
};

/**
 * Helper to extract client IP from Next.js request headers.
 */
export function getClientIP(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp;
  return "127.0.0.1";
}

/**
 * Apply rate limiting and return a 429 response if the limit is exceeded.
 * Returns null if the request is allowed.
 *
 * @example
 * ```ts
 * const limitResponse = applyRateLimit(req, session.user.id, AI_CALLS_LIMIT);
 * if (limitResponse) return limitResponse;
 * ```
 */
export function applyRateLimit(
  _request: Request,
  identifier: string,
  config: RateLimitConfig
): Response | null {
  const result = checkRateLimit(identifier, config);

  if (!result.allowed) {
    const resetSeconds = Math.ceil((result.resetAt - Date.now()) / 1000);
    return new Response(
      JSON.stringify({
        error: "请求过于频繁，请稍后再试",
        retryAfter: resetSeconds,
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(resetSeconds),
        },
      }
    );
  }

  // Set rate limit headers for client awareness
  // (returned for the caller to add to their response if desired)
  return null;
}
