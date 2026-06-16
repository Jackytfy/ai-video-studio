const Database = require("better-sqlite3");
const path = require("path");
const dbFile = path.join(__dirname, "..", "prisma", "dev.db");

try {
  const db = new Database(dbFile, { readonly: true });
  const wal = db.pragma("journal_mode");
  const busy = db.pragma("busy_timeout");
  const versions = db.pragma("user_version");
  console.log("数据库: " + dbFile);
  console.log("WAL模式: " + (wal ? "WAL" : "DELETE"));
  console.log("busy_timeout: " + busy + "ms");
  console.log("user_version: " + versions);

  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  console.log("表数量: " + tables.length);
  tables.forEach(t => console.log("  - " + t.name));
  db.close();
  console.log("\n数据库连接正常!");
} catch (err) {
  console.log("数据库测试: " + err.message);
}
