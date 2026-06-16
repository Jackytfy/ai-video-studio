require("dotenv/config");
var db = require("better-sqlite3")("dev.db");
db.prepare("UPDATE Project SET status='STORYBOARD_READY' WHERE status='RENDERING'").run();
var p = db.prepare("SELECT id, userId FROM Project ORDER BY createdAt DESC LIMIT 1").get();
db.close();

console.log("项目: " + p.id);
console.log("开始渲染...");

var { renderProjectInline } = require("../src/lib/render/pipeline");
renderProjectInline(p.id, p.userId)
  .then(function(r) {
    console.log("✅ 完成:", r.outputUrl);
    console.log("时长:", r.duration.toFixed(1) + "s");
    process.exit(0);
  })
  .catch(function(e) {
    console.error("❌ 失败:", e.message);
    process.exit(1);
  });
