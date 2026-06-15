/**
 * Unified RenderEngine — single entry point for all rendering paths.
 *
 * Problem: 4 separate render implementations (pipeline.ts, workers/index.ts,
 * render-editor, export) duplicated core logic with inconsistent behavior
 * (different concat strategies, missing subtitle support, divergent storage).
 *
 * Solution: Single RenderEngine wrapping the canonical pipeline.ts as the
 * only full-featured render implementation. Other paths (editor, export)
 * remain as lightweight wrappers for their specific use cases.
 *
 * This is step 1 of the render unification (#12). Future steps:
 *   2. Replace workers/index.ts with render-worker.ts (done in #13)
 *   3. Extract StorageProvider interface for S3 vs local filesystem
 */

export { renderProjectInline } from "./pipeline";

import type { RenderConfig } from "./pipeline";

// Re-export the canonical implementation
export type { RenderConfig };

/**
 * Storage provider type — placeholder for future S3/local abstraction.
 */
export interface StorageProvider {
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Buffer): Promise<void>;
  getPublicUrl(path: string): string;
}

/**
 * Create a local filesystem storage provider.
 */
export function createLocalStorage(): StorageProvider {
  const { readFile: rf, writeFile: wf } = require("fs/promises");
  return {
    readFile: async (path: string) => rf(path),
    writeFile: async (path: string, data: Buffer) => wf(path, data),
    getPublicUrl: (path: string) => `/api/uploads/${path}`,
  };
}
