/**
 * Repository abstraction layer — prepares for future Postgres migration.
 *
 * Currently just re-exports prisma directly. When migrating to Postgres:
 *   1. Replace this file with a repository interface per domain entity
 *   2. Each repository encapsulates the SQL dialect differences
 *   3. Prisma's schema-first approach handles most of the migration,
 *      but the repository layer catches the remaining dialect gaps
 *      (e.g. SQLite PRAGMAs, JSONB operators, connection pooling)
 *
 * This is a lightweight abstraction — no unnecessary indirection.
 * The goal is to have ONE file to change when switching databases.
 */

import { prisma } from "./index";

// Re-export prisma for direct use (same as before).
// All code uses `import { prisma } from "@/lib/db"` which now
// resolves to this file instead of `index.ts` directly.

export { prisma };

// ── Future repository interfaces (scaffold) ──
//
// When migrating to Postgres, uncomment and implement:
//
// export interface ProjectRepository {
//   findById(id: string, userId: string): Promise<Project | null>;
//   updateStatus(id: string, status: ProjectState): Promise<void>;
//   ...
// }
//
// SQLite-specific concerns that need abstraction:
//   - WAL mode / journal mode (Postgres doesn't need this)
//   - busy_timeout (SQLite-only)
//   - $queryRaw replacements for Postgres-specific features
//   - JSONB → json_extract() / ->> operators
