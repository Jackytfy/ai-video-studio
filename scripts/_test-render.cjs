// Test render via normal API with sync mode
const Database = require('better-sqlite3');
const path = require('path');
const http = require('http');

const dbPath = path.join(__dirname, '..', 'prisma', 'dev.db');
const db = new Database(dbPath);

async function main() {
  // Get the first project
  const project = db.prepare("SELECT id FROM Project LIMIT 1").get();
  if (!project) {
    console.error('No projects found!');
    process.exit(1);
  }
  
  const projectId = project.id;
  console.log(`Testing render for project: ${projectId}`);
  
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({});
    
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: `/api/projects/${projectId}/render?sync=true`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 600000
    };

    console.log('\nCalling render API (sync mode)...');
    console.log('(This will take several minutes)\n');

    const req = http.request(options, (res) => {
      let data = '';
      
      console.log(`Status: ${res.statusCode}`);
      
      res.on('data', (chunk) => {
        data += chunk;
        process.stdout.write('.');
      });
      
      res.on('end', () => {
        console.log('\n\n=== Response ===');
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ raw: data.substring(0, 1000) });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      console.error('\nTimeout!');
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.write(postData);
    req.end();
  });
}

main()
  .then(result => {
    console.log(JSON.stringify(result, null, 2));
  })
  .catch(error => {
    console.error('Error:', error.message);
  })
  .finally(() => db.close());
