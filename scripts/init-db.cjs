const Database = require('better-sqlite3');
const db = new Database('dev.db');

// Create default user
const userId = 'cmp3v2aqa0000k8ulak8r79d5';
try {
  db.prepare(`INSERT INTO User (id, name, email, passwordHash, role, "aiProvider", "aiModel", "ttsProvider", "ttsVoice", "createdAt", "updatedAt")
    VALUES (?, '默认用户', 'user@ai-video.local', 'hashed', 'USER', 'openai', 'mimo-v2.5-pro', 'edge-tts', 'zh-CN-YunxiNeural', datetime('now'), datetime('now'))`).run(userId);
  console.log('Created default user:', userId);
} catch (e) {
  console.log('User may already exist:', e.message);
}

// Verify
const users = db.prepare('SELECT id, name FROM User').all();
console.log('Users:', JSON.stringify(users));

// Verify materialRequirements column
const cols = db.pragma('table_info(Project)');
console.log('Has materialRequirements:', cols.some(c => c.name === 'materialRequirements'));

db.close();
