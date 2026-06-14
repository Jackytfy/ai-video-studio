const Database = require('better-sqlite3');
const db = new Database('F:/创作/20260512/ai-video-studio/dev.db');
const projects = db.prepare(`SELECT id, name, status FROM Project`).all();
console.log('Projects:', projects);
db.close();
