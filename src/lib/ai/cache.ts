import { createHash } from "crypto";
import { prisma } from "@/lib/db";

/**
 * AI Response Cache — avoids duplicate LLM calls for the same input.
 * Backed by the `AICache` Prisma model (properly migrated via `prisma migrate`).
 * No more `$queryRawUnsafe` or `CREATE TABLE IF NOT EXISTS` self-bootstrapping.
 *
 * Cache key = SHA256(operation + ...parts)[:32]
 */

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
    const entry = await prisma.aICache.findUnique({ where: { cacheKey } });
    if (!entry) return null;

    const age = Date.now() - entry.createdAt.getTime();
    if (age > maxAgeMs) {
      await prisma.aICache.delete({ where: { id: entry.id } });
      return null;
    }

    return JSON.parse(entry.result) as T;
  } catch {
    // AICache table might not exist yet (run `npx prisma db push`)
    return null;
  }
}

/**
 * Store an AI result in cache. Uses upsert to handle key conflicts.
 */
export async function setCachedResult<T>(
  operation: string,
  parts: string[],
  result: T
): Promise<void> {
  const cacheKey = makeCacheKey(operation, ...parts);
  const now = new Date();

  try {
    await prisma.aICache.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        operation,
        result: JSON.stringify(result),
        createdAt: now,
      },
      update: {
        operation,
        result: JSON.stringify(result),
        createdAt: now,
      },
    });
  } catch {
    // Silently fail — caching is optional. Run `npx prisma db push` if the
    // AICache table is missing.
  }
}

/**
 * Clear expired cache entries. Call periodically (e.g. cron job).
 */
export async function clearExpiredCache(
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000
): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - maxAgeMs);
    const { count } = await prisma.aICache.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return count;
  } catch {
    return 0;
  }
}

// Export for direct Prisma access in migration scripts if needed
export { prisma };
