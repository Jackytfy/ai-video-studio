// Check actual database structure
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '..', 'prisma', 'dev.db');
const db = new Database(dbPath);

console.log('=== All Tables ===');
try {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  tables.forEach(t => console.log('-', t.name));
} catch (e) {
  console.log('Error:', e.message);
}

console.log('\n=== RenderJob Columns ===');
try {
  const columns = db.prepare("PRAGMA table_info(RenderJob)").all();
  if (columns.length === 0) {
    console.log('RenderJob table does not exist');
  } else {
    columns.forEach(c => console.log('-', c.name, c.type));
  }
} catch (e) {
  console.log('Error:', e.message);
}

console.log('\n=== Recent Render Jobs (raw) ===');
try {
  // Get all columns dynamically
  const jobInfo = db.prepare("PRAGMA table_info(RenderJob)").all();
  const cols = jobInfo.map(c => c.name).join(', ');
  
  const jobs = db.prepare(`SELECT ${cols} FROM RenderJob ORDER BY createdAt DESC LIMIT 3`).all();
  if (jobs.length === 0) {
    console.log('No jobs found');
  } else {
    jobs.forEach(j => {
      // Only show key fields
      console.log(JSON.stringify({
        id: j.id,
        status: j.status,
        projectId: j.projectId,
        currentStage: j.currentStage,
        progress: j.progress
      }, null, 2));
    });
  }
} catch (e) {
  console.log('Error:', e.message);
}

db.close();
