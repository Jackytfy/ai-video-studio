import { createHash } from "crypto";
import { prisma } from "@/lib/db";

/**
 * AI Response Cache - avoids duplicate LLM calls for the same input.
 * Uses SQLite via Prisma for persistence.
 * Cache key = hash(input + operation + config).
 */

interface CacheEntry {
  id: string;
  cacheKey: string;
  operation: string;
  result: string;
  createdAt: Date;
}

function makeCacheKey(operation: string, ...parts: string[]): string {
  const raw = [operation, ...parts].join("|");
  return createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

/**
 * Try to get a cached AI result. Returns null if not found or expired.
 */
export async function getCachedResult<T>(
  operation: string,
  parts: string[],
  maxAgeMs: number = 24 * 60 * 60 * 1000 // 24 hours default
): Promise<T | null> {
  const cacheKey = makeCacheKey(operation, ...parts);

  try {
    // Use raw query since we don't have a dedicated cache model
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; cacheKey: string; result: string; createdAt: string }>>(
      `SELECT id, cacheKey, result, createdAt FROM ai_cache WHERE cacheKey = ? LIMIT 1`,
      cacheKey
    );

    if (rows.length === 0) return null;

    const entry = rows[0];
    const age = Date.now() - new Date(entry.createdAt).getTime();

    if (age > maxAgeMs) {
      // Expired, delete
      await prisma.$executeRawUnsafe(`DELETE FROM ai_cache WHERE id = ?`, entry.id);
      return null;
    }

    return JSON.parse(entry.result) as T;
  } catch {
    // Table might not exist yet
    return null;
  }
}

/**
 * Store an AI result in cache.
 */
export async function setCachedResult<T>(
  operation: string,
  parts: string[],
  result: T
): Promise<void> {
  const cacheKey = makeCacheKey(operation, ...parts);

  try {
    await prisma.$executeRawUnsafe(
      `INSERT OR REPLACE INTO ai_cache (id, cacheKey, operation, result, createdAt) VALUES (?, ?, ?, ?, ?)`,
      cacheKey,
      cacheKey,
      operation,
      JSON.stringify(result),
      new Date().toISOString()
    );
  } catch {
    // Table might not exist yet — try creating it
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS ai_cache (
          id TEXT PRIMARY KEY,
          cacheKey TEXT UNIQUE NOT NULL,
          operation TEXT NOT NULL,
          result TEXT NOT NULL,
          createdAt TEXT NOT NULL
        )
      `);
      await prisma.$executeRawUnsafe(
        `INSERT OR REPLACE INTO ai_cache (id, cacheKey, operation, result, createdAt) VALUES (?, ?, ?, ?, ?)`,
        cacheKey,
        cacheKey,
        operation,
        JSON.stringify(result),
        new Date().toISOString()
      );
    } catch {
      // Silently fail — caching is optional
    }
  }
}

/**
 * Clear expired cache entries. Call periodically.
 */
export async function clearExpiredCache(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
    const result = await prisma.$executeRawUnsafe(
      `DELETE FROM ai_cache WHERE createdAt < ?`,
      cutoff
    );
    return result;
  } catch {
    return 0;
  }
}
