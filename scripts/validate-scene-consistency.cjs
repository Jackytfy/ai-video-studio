/**
 * Pre-render storyboard consistency validation.
 * Checks visualDesc <-> materialQuery <-> sourceVideos alignment
 * without requiring a full render cycle.
 *
 * Usage: node scripts/validate-scene-consistency.cjs [projectId]
 *   If no projectId given, validates all projects.
 */

const Database = require("better-sqlite3");
const path = require("path");
const dbPath = path.resolve(__dirname, "../prisma/dev.db");

let db;
try {
  db = new Database(dbPath, { readonly: true });
} catch (err) {
  console.error(`Cannot open database at ${dbPath}:`, err.message);
  process.exit(1);
}

const projectId = process.argv[2];

let scenes;
if (projectId) {
  scenes = db.prepare(`
    SELECT s.sceneNumber, s.visualDesc, s.materialQuery, s.productionMeta, s.materialId,
           st.projectId
    FROM Scene s
    JOIN Storyboard st ON s.storyboardId = st.id
    WHERE st.projectId = ?
    ORDER BY s.sceneNumber ASC
  `).all(projectId);
} else {
  scenes = db.prepare(`
    SELECT s.sceneNumber, s.visualDesc, s.materialQuery, s.productionMeta, s.materialId,
           st.projectId
    FROM Scene s
    JOIN Storyboard st ON s.storyboardId = st.id
    ORDER BY st.projectId, s.sceneNumber ASC
  `).all();
}

if (scenes.length === 0) {
  console.log("No scenes found.");
  db.close();
  process.exit(0);
}

// Simplified keyword extraction (mirrors search-engine.ts logic)
function extractKeywords(text) {
  if (!text) return [];
  const nonSearchable = new Set([
    "画面", "描述", "展现", "展示", "呈现", "表现", "体现", "反映",
    "风格", "色调", "氛围", "镜头", "光影", "构图", "采用", "运用",
    "使用", "适合", "需要", "可以", "强烈", "突出", "营造",
    "例如", "视频", "片段", "该部", "这部", "中的", "聚焦", "注重",
    "整体", "相关", "经典", "缓缓", "慢慢", "快速", "逐渐",
    "最终", "开始", "结束", "显示", "映照", "笼罩", "充满", "转为",
    "变为", "化为", "定格", "切换", "这是", "那是", "他的", "她的",
    "我的", "这个", "那个", "这些", "那些", "最后", "首先", "然后",
    "接着", "同时", "此时", "近景", "远景", "全景", "特写",
  ]);
  const keywords = [];
  const seen = new Set();

  // Pass 1: Segment by particles, extract 4-8 char content phrases
  const phrases = text.split(/[，,。；;！!？?、：:\s]+/).filter(p => p.length >= 4);
  for (const phrase of phrases) {
    const segments = phrase.match(/[一-鿿]{4,8}/g) || [];
    for (const seg of segments) {
      if (nonSearchable.has(seg) || seen.has(seg)) continue;
      keywords.push(seg);
      seen.add(seg);
      if (keywords.length >= 10) break;
    }
    if (keywords.length >= 10) break;
  }

  // Pass 2: 2-3 char keywords
  if (keywords.length < 10) {
    const shortWords = text.match(/[一-鿿]{2,3}/g) || [];
    for (const w of shortWords) {
      if (seen.has(w) || nonSearchable.has(w)) continue;
      if (/[在的了着过和与及把被从向往]$/.test(w)) continue;
      keywords.push(w);
      seen.add(w);
      if (keywords.length >= 10) break;
    }
  }
  return keywords;
}

let totalIssues = 0;
let totalOk = 0;
let currentProject = null;

for (const s of scenes) {
  // Group output by project
  if (s.projectId !== currentProject) {
    currentProject = s.projectId;
    console.log(`\n--- Project ${currentProject} ---`);
  }

  let meta = {};
  try { meta = JSON.parse(s.productionMeta || "{}"); } catch {}
  const sourceVideos = meta.sourceVideos || [];
  const visKeywords = extractKeywords(s.visualDesc || "");
  const mqParts = (s.materialQuery || "").split(/[\s,，、]+/).filter(p => p.length >= 2);
  const sceneIssues = [];

  // Check 1: visualDesc length
  if ((s.visualDesc || "").length < 30) {
    sceneIssues.push(`visualDesc too short (${(s.visualDesc || "").length} chars)`);
  }

  // Check 2: materialQuery keyword overlap with visualDesc
  const overlap = mqParts.filter(p => (s.visualDesc || "").includes(p));
  if (mqParts.length > 0 && overlap.length === 0) {
    sceneIssues.push(`materialQuery "${s.materialQuery}" shares no keywords with visualDesc`);
  }

  // Check 3: sourceVideos is empty
  if (sourceVideos.length === 0) {
    sceneIssues.push("sourceVideos is empty");
  }

  // Check 4: visualDesc keywords extracted
  if (visKeywords.length === 0) {
    sceneIssues.push("extractVisualDescKeywords returns 0 keywords");
  }

  if (sceneIssues.length === 0) {
    console.log(`  S${s.sceneNumber}: OK (keywords: ${visKeywords.slice(0, 3).join(", ")}...)`);
    totalOk++;
  } else {
    sceneIssues.forEach(issue => {
      console.log(`  S${s.sceneNumber}: ISSUE - ${issue}`);
    });
    totalIssues += sceneIssues.length;
  }
}

console.log(`\n=== Consistency Report ===`);
console.log(`Total scenes: ${scenes.length}`);
console.log(`OK: ${totalOk}, Issues: ${totalIssues}`);

if (totalIssues > 0) {
  console.log(`\nTip: Issues in materialQuery/visualDesc alignment may cause irrelevant material search.`);
  console.log(`Ensure AI prompt generates consistent visualDesc, materialQuery, and sourceVideos.`);
}

db.close();
process.exit(totalIssues > 0 ? 1 : 0);
