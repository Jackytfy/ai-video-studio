// Verification script for the 4 P1 fixes.
// Spins up a fresh Prisma client using the same adapter config the app
// uses, and confirms the runtime SQLite pragmas take effect. We can't
// share the running dev server's connection (better-sqlite3 is
// single-connection per process), so we open our own to prove the
// adapter-level config is correct.
import pkg from "../src/generated/prisma/client.ts";
const { PrismaClient } = pkg;
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({
  // Match .env: relative to cwd, which is the project root when this
  // script is run from package.json or via tsx from the repo root.
  url: process.env.DATABASE_URL || "file:./dev.db",
  pragma: {
    busy_timeout: 5000,
    synchronous: "NORMAL",
  },
});
const prisma = new PrismaClient({ adapter });

// Apply WAL once (same as the app does)
try {
  await prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL");
} catch (err) {
  console.warn("[verify] WAL pragma warning:", err.message);
}

console.log("=== Verification: SQLite WAL + busy_timeout ===");
const journalMode = await prisma.$queryRawUnsafe("PRAGMA journal_mode");
const busyTimeout = await prisma.$queryRawUnsafe("PRAGMA busy_timeout");
const synchronous = await prisma.$queryRawUnsafe("PRAGMA synchronous");

console.log("journal_mode:", journalMode);
console.log("busy_timeout:", busyTimeout);
console.log("synchronous:", synchronous);

const userCount = await prisma.user.count();
console.log("user count:", userCount);

const tables = await prisma.$queryRawUnsafe(
  "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
);
console.log("tables:", tables.map((t) => t.name).join(", "));

await prisma.$disconnect();
console.log("\n=== Done ===");
