// Seed default user for development
import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = "F:/data/ai-video-studio.db"; // Use absolute path to avoid Chinese character issues

const db = new Database(dbPath);

const userId = "user_default_dev_001";
const now = new Date().toISOString();

// Check if user exists
const existingUser = db.prepare("SELECT id FROM User WHERE id = ?").get(userId);

if (!existingUser) {
  db.prepare(`
    INSERT INTO User (id, email, name, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    userId,
    "dev@example.com",
    "Developer",
    now,
    now
  );
  console.log("✅ Created default user:", userId);
} else {
  console.log("ℹ️  Default user already exists:", userId);
}

db.close();
console.log("\nDone! You can now create projects.");
