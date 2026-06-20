// Direct render pipeline test (bypasses auth)
import 'dotenv/config';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, join } from 'path';
import Database from 'better-sqlite3';

// Override DATABASE_URL to use test database
process.env.DATABASE_URL = 'file:./test-dev.db';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Setup test database
const dbPath = join(__dirname, '..', 'test-dev.db');
const db = new Database(dbPath);

async function setupTestData() {
  console.log('Setting up test data...\n');
  
  const now = new Date().toISOString();
  
  // Create user
  const userId = 'user_3bf053f00f7a91c5';
  const existingUser = db.prepare('SELECT id FROM User WHERE id = ?').get(userId);
  
  if (!existingUser) {
    db.prepare(`
      INSERT INTO User (id, email, name, createdAt, updatedAt) 
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, 'test@example.com', 'Test User', now, now);
    console.log('Created user:', userId);
  }
  
  // Create project
  const projectId = 'cmpsyvo0x000364ul6zx2xpsx';
  const existingProject = db.prepare('SELECT id FROM Project WHERE id = ?').get(projectId);
  
  if (!existingProject) {
    db.prepare(`
      INSERT INTO Project (id, name, userId, status, sourceText, renderMode, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(projectId, 'AI Video Test', userId, 'DRAFT', '人工智能正在改变我们的世界', 'ai_video', now, now);
    console.log('Created project:', projectId);
    
    // Create storyboard
    const storyboardId = 'storyboard-test-001';
    db.prepare(`
      INSERT INTO Storyboard (id, projectId, status, totalScenes, totalDuration, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(storyboardId, projectId, 'CONFIRMED', 3, 15, now, now);
    console.log('Created storyboard:', storyboardId);
    
    // Create scenes
    const scenes = [
      { sceneNumber: 1, voiceoverText: '人工智能正在改变我们的世界，从手机助手到自动驾驶。', visualDesc: '科技场景：未来城市中AI助手与人类互动' },
      { sceneNumber: 2, voiceoverText: '深度学习让计算机能够从海量数据中学习规律。', visualDesc: '数据中心：服务器机柜闪烁着蓝光，数据流动可视化' },
      { sceneNumber: 3, voiceoverText: '未来，AI将成为每个人的智能助手和创新工具。', visualDesc: '办公场景：专业人士使用AI工具高效工作' },
    ];
    
    for (const scene of scenes) {
      const sceneId = `scene-${scene.sceneNumber}-${Date.now()}`;
      db.prepare(`
        INSERT INTO Scene (id, storyboardId, sceneNumber, voiceoverText, visualDesc, materialQuery, sceneType, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(sceneId, storyboardId, scene.sceneNumber, scene.voiceoverText, scene.visualDesc, 'AI technology', 'AI_GENERATED', now, now);
      console.log(`Created scene ${scene.sceneNumber}: ${scene.voiceoverText.substring(0, 30)}...`);
    }
  }
  
  db.close();
  console.log('\nTest data ready!\n');
}

// Import with file:// URL for Windows compatibility
const pipelineUrl = pathToFileURL(join(__dirname, '..', 'src', 'lib', 'render', 'pipeline.ts')).href;
const { renderProjectInline } = await import(pipelineUrl);

async function main() {
  try {
    await setupTestData();
    
    console.log('=== Direct Render Pipeline Test ===\n');
    console.log('Starting render...');
    console.log('(This will take several minutes - TTS + Materials + Compose)\n');
    
    const startTime = Date.now();
    
    const projectId = 'cmpsyvo0x000364ul6zx2xpsx';
    const userId = 'user_3bf053f00f7a91c5';
    
    const result = await renderProjectInline(projectId, userId);
    
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('\n=== RENDER COMPLETE ===');
    console.log(`Duration: ${elapsed}s`);
    console.log(`Output URL: ${result.outputUrl}`);
    console.log(`Video Duration: ${result.duration}s`);
    
  } catch (error) {
    console.error('\n=== RENDER FAILED ===');
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
  }
}

main();
