// Check if project exists and try direct render
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'prisma', 'dev.db');
const db = new Database(dbPath);

console.log('=== Checking Project ===');
const project = db.prepare("SELECT * FROM Project WHERE id = ?").get('cmpsyvo0x000364ul6zx2xpsx');
if (project) {
  console.log('Project found:', JSON.stringify(project, null, 2));
} else {
  console.log('Project NOT found in database');
  
  // List all projects
  const allProjects = db.prepare("SELECT id, name, status, renderMode FROM Project").all();
  console.log('\nAll projects:', JSON.stringify(allProjects, null, 2));
}

db.close();
