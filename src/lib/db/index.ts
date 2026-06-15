import { PrismaClient } from "@/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { validateEnv } from "@/lib/utils/env";

validateEnv();

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  // SQLite tuning:
  //   - `journal_mode = WAL` enables Write-Ahead Logging. With the default
  //     `delete` journal the whole DB is locked for the duration of any
  //     write, so 4-way concurrent material/TTS updates collide on
  //     `SQLITE_BUSY`. WAL lets readers proceed in parallel with a single
  //     writer.
  //   - `busy_timeout = 5000` makes SQLite wait up to 5s for the lock
  //     instead of failing immediately. Pairs with WAL to smooth out the
  //     remaining write contention.
  //   - `synchronous = NORMAL` (recommended with WAL) trades the
  //     <1ms-fsync-after-every-commit for a small chance of losing the
  //     last transaction on a power cut. Acceptable for a render app
  //     where re-running a job costs minutes, not data.
  //
  // better-sqlite3's `pragma` constructor option only works for
  // "value" pragmas like `busy_timeout` / `synchronous`. For
  // `journal_mode` (a "result" pragma) the option is silently ignored.
  // So we set what we can via the constructor, then run `journal_mode`
  // once via a raw query. The WAL change is persistent (it lives in the
  // file's header), so subsequent reopens inherit it. The busy_timeout
  // is per-connection; with better-sqlite3's single-connection model
  // setting it once at open is enough.
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL || "file:./dev.db",
    pragma: {
      busy_timeout: 5000,
      synchronous: "NORMAL",
    },
  });
  const client = new PrismaClient({ adapter });

  // Apply WAL once. The query is idempotent — once the file is in WAL
  // mode the pragma is a no-op. We swallow errors so a read-only DB
  // (e.g. a corrupted test fixture) doesn't take the whole process down.
  client.$executeRawUnsafe("PRAGMA journal_mode = WAL").catch((err) => {
    console.warn("[db] failed to enable WAL journal mode:", err);
  });

  return client;
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
