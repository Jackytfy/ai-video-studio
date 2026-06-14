const Database = require("better-sqlite3");
const path = require("path");
const dbPath = path.resolve(__dirname, "../prisma/dev.db");
const db = new Database(dbPath);
const projectId = process.argv[2] || "cmqcyhvcy001b2kulge0huxpn";

const scenes = db.prepare(`
  SELECT s.id, s.sceneNumber, s.productionMeta, s.materialId,
         m.name as materialName, m.searchQuery, m.externalSource, m.externalId
  FROM Scene s
  JOIN Storyboard st ON s.storyboardId = st.id
  LEFT JOIN Material m ON s.materialId = m.id
  WHERE st.projectId = ?
  ORDER BY s.sceneNumber ASC
`).all(projectId);

let matched = 0, other = 0, none = 0;

for (const s of scenes) {
  let m = {};
  try { m = JSON.parse(s.productionMeta || "{}"); } catch {}
  const sv = m.sourceVideos || [];

  if (!s.materialId) { none++; console.log(`S${s.sceneNumber}: NO MATERIAL`); continue; }

  const t = s.materialName || "";
  const q = s.searchQuery || "";
  const src = s.externalSource || "";

  let isMatch = false;
  for (const v of sv) {
    const vc = v.replace(/[\s【】\[\]「」『』]/g, "");
    const tc = t.replace(/[\s【】\[\]「」『』]/g, "");
    if (tc.includes(vc)) { isMatch = true; break; }
    const a1 = vc.slice(0, Math.ceil(vc.length / 2));
    const a2 = vc.slice(-Math.ceil(vc.length / 2));
    if ((a1.length >= 2 && tc.includes(a1)) || (a2.length >= 2 && tc.includes(a2))) {
      isMatch = true; break;
    }
  }

  if (isMatch) {
    matched++;
    console.log(`S${s.sceneNumber}: ✅ [${sv.join("/")}] -> "${t.slice(0, 50)}" (q="${q}" src=${src})`);
  } else {
    other++;
    console.log(`S${s.sceneNumber}: ⚠️ [${sv.join("/")}] -> "${t.slice(0, 50)}" (q="${q}" src=${src})`);
  }
}

const total = scenes.length;
console.log(`\n=== 统计 ===`);
console.log(`总场景: ${total}`);
console.log(`来自推荐剧: ${matched} (${total > 0 ? Math.round(matched / total * 100) : 0}%)`);
console.log(`非推荐剧: ${other} (${total > 0 ? Math.round(other / total * 100) : 0}%)`);
console.log(`无素材: ${none}`);

db.close();
