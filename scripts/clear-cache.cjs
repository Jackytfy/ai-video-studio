const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.resolve(__dirname, "../prisma/dev.db");
console.log("DB path:", dbPath);

try {
  const db = new Database(dbPath);

  // Check if ai_cache table exists
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ai_cache'").all();
  if (tables.length === 0) {
    console.log("ai_cache table does not exist, nothing to clear");
  } else {
    const result = db.prepare("DELETE FROM ai_cache").run();
    console.log(`Cleared ${result.changes} AI cache entries`);
  }

  db.close();
} catch (e) {
  console.error("Error:", e.message);
}
