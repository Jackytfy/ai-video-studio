/**
 * Zod schemas for Scene.productionMeta JSON field.
 *
 * Centralizes validation so IDE autocompletion and runtime type-checking
 * work across all producers and consumers of productionMeta.
 */

import { z } from "zod";

// ── Script ──────────────────────────────────────────────────────────

export const ScriptSchema = z.object({
  text: z.string().min(1, "脚本行不能为空"),
  /** Estimated duration in seconds for this script line */
  duration: z.number().positive().optional(),
});

// ── Source video ────────────────────────────────────────────────────

export const SourceVideoSchema = z.object({
  name: z.string(),
  /** Preferred show/movie name on Bilibili */
  bilibiliSearch: z.string().optional(),
  /** Preferred description tags */
  keywords: z.array(z.string()).optional(),
});

// ── Production metadata ─────────────────────────────────────────────

export const ProductionMetaSchema = z.object({
  /** Voiceover scripts (one per line) */
  scripts: z.array(ScriptSchema).optional(),

  /** Preferred source videos for this scene */
  sourceVideos: z.array(SourceVideoSchema).optional(),

  /** Material search query (English, for Pexels etc.) */
  materialQueryEn: z.string().optional(),

  /** Material search query (Chinese, for Bilibili) */
  materialQuery: z.string().optional(),

  /** Visual description for material search */
  visualDescription: z.string().optional(),

  /** Visual keywords extracted from scene */
  visualKeywords: z.array(z.string()).optional(),

  /** Additional material requirements */
  materialRequirements: z
    .object({
      /** Keywords to prefer */
      prefer: z.array(z.string()).optional(),
      /** Keywords to avoid */
      avoid: z.array(z.string()).optional(),
      /** Preferred sources */
      sources: z.array(z.string()).optional(),
      /** Era / time period preference */
      era: z.string().optional(),
    })
    .optional(),

  /** Scene-specific notes */
  notes: z.string().optional(),

  /** Duration override in seconds */
  duration: z.number().positive().optional(),
});

export type ProductionMeta = z.infer<typeof ProductionMetaSchema>;
export type Script = z.infer<typeof ScriptSchema>;
export type SourceVideo = z.infer<typeof SourceVideoSchema>;

/**
 * Safely parse and validate productionMeta JSON.
 * Returns the parsed object or null if parsing/validation fails.
 */
export function parseProductionMeta(json: unknown): ProductionMeta | null {
  if (typeof json === "object" && json !== null) {
    const result = ProductionMetaSchema.safeParse(json);
    if (result.success) return result.data;
    console.warn("[Schema] productionMeta validation failed:", result.error.issues);
    return null;
  }

  if (typeof json === "string") {
    try {
      const parsed = JSON.parse(json);
      return parseProductionMeta(parsed);
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Parse productionMeta with a fallback to raw object (for backwards compat).
 * Always returns an object (possibly empty), never throws.
 */
export function getProductionMeta(json: unknown): ProductionMeta {
  return parseProductionMeta(json) ?? {};
}
