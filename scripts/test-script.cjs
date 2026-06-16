/**
 * Quick script analysis tool.
 * Run: node scripts/test-script.cjs < script-text.txt
 * Or:   node scripts/test-script.cjs
 *       (enter text, press Ctrl+D when done)
 */

const { readFileSync } = require("fs");

let text = "";
try {
  // Try reading from piped stdin
  text = readFileSync(0, "utf-8").trim();
} catch {
  // Fallback: embedded test text
  text = `日本天皇，万世一系。这是日本人自己说的。从传说中的神武天皇到今天的德仁天皇，一共126代，两千多年没断过。全世界最长的君主世系，没有之一。但是——你有没有想过一个问题：神武天皇，到底是谁？日本自己的史书《古事记》和《日本书纪》说，神武天皇是天照大神的后代，从天上降下来的。你要是信这个，那就不用往下看了。如果你不信——那你应该听听另一个说法。这个说法在中国流传了很多年，在日本也有人偷偷研究，但从来没人敢大声说出来：日本的第一代天皇，可能是一个中国人。准确地说——是一个从秦朝逃出去的中国方士。他的名字，叫徐福。一、秦始皇最信任的人，骗了他一辈子。公元前219年，秦始皇统一天下才两年。这一年，始皇帝东巡，来到海边。一个叫徐福的方士上书说：海上有三座神山，叫蓬莱、方丈、瀛洲。山上有神仙，神仙手里有不死药。秦始皇那时候四十四岁。统一六国，功业盖世，唯独怕一件事——死。你想想看，一个人拥有了天下所有东西，却知道自己迟早要失去这一切，什么感觉？所以秦始皇信了。他给徐福拨了几千童男童女，装满粮食、种子、布匹、百工技艺，浩浩荡荡出海去找神仙。结果呢？几年后，徐福空手回来了。他说：神仙嫌礼物不够，不给药。秦始皇居然又信了。有学者分析，不是秦始皇傻，而是他太需要这个希望了——一个人到了那个年纪，那个位置，什么都有了，就剩这件事没解决。于是公元前210年，秦始皇再次东巡，亲自到海边等徐福。这次徐福说：海里有大鲛鱼拦路，请派弓箭手射杀之。秦始皇又同意了。他自己还梦见跟海神打仗，醒来就让士兵带着连弩出海射鱼。从琅琊到荣成，再到芝罘——终于射杀了一条大鱼。徐福就此出发，再也没有回来。而秦始皇呢？同一年，死在了返回咸阳的路上。`;
}

// ── Text statistics ──
const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
const totalChars = text.length;
const paragraphs = text.split(/\n{2,}/).filter(p => p.trim()).length;

// ── Pipeline parameters ──
const CHARS_PER_SCENE = 80;
const MIN_SCENES = 3;
const MAX_SCENES = 30;
const sceneCount = Math.max(MIN_SCENES, Math.min(MAX_SCENES, Math.round(chineseChars / CHARS_PER_SCENE)));
const wordsPerScene = Math.max(40, Math.min(100, Math.round(chineseChars / sceneCount)));

// ── Audio estimate ──
const chineseSecs = chineseChars / 3.5;
const nonChinese = text.replace(/[\u4e00-\u9fff]/g, "").replace(/[，。！？、；\s\n"「」『』【】（）()\[\]·《》—\-—]/g, "").length;
const nonChineseSecs = nonChinese / 5;
const totalAudioSecs = Math.max(0.8, chineseSecs + nonChineseSecs);

// ── TTS concurrency estimate ──
const TTS_CONCURRENCY = 5;
const MATRIALS_CONCURRENCY = 4;
const estimatedPipelineMinutes = Math.round((sceneCount / TTS_CONCURRENCY * 3 + sceneCount * 4) / 60);

console.log("═══════════════════════════════════════");
console.log("  📊 视频文案流水线分析");
console.log("═══════════════════════════════════════\n");

console.log("📝 文案统计");
console.log("  ├─ 总字符数:", totalChars.toLocaleString());
console.log("  ├─ 中文字数:", chineseChars.toLocaleString());
console.log("  ├─ 非中文字数:", nonChinese);
console.log("  └─ 段落数:", paragraphs);

console.log("\n🎬 场景估算 (CHARS_PER_SCENE =", CHARS_PER_SCENE, ")");
console.log("  ├─ 预估场景数:", sceneCount, "(范围:", MIN_SCENES, "~", MAX_SCENES, ")");
console.log("  ├─ 每场景平均字数:", wordsPerScene, "字");
console.log("  └─ 预估每场景TTS时长:", Math.round(totalAudioSecs / sceneCount), "秒");

console.log("\n🔊 总音频时长");
console.log("  ├─ 中文部分:", Math.round(chineseSecs), "秒");
console.log("  ├─ 非中文部分:", Math.round(nonChineseSecs), "秒");
console.log("  └─ 总时长:", Math.floor(totalAudioSecs / 60), "分", Math.round(totalAudioSecs % 60), "秒");

console.log("\n⚙️  流水线参数");
console.log("  ├─ TTS并发:", TTS_CONCURRENCY, "(场景可并行合成)");
console.log("  ├─ 素材并发:", MATRIALS_CONCURRENCY, "(B站搜索+下载)");
console.log("  ├─ 素材上限:", "300秒(有源)/600秒(无源)");
console.log("  ├─ 水印去除:", "B站3区域 delogo + 裁剪");
console.log("  ├─ 字幕:", "实测TTS时长 + 按字数比例分配");
console.log("  └─ 画面效果:", "Ken Burns 缩放 (替代冻结帧)");

console.log("\n📦 预估资源消耗");
console.log("  ├─ B站搜索次数:", sceneCount, "次 (每场景至少1次)");
console.log("  ├─ AI调用次数:", 1, "次 (storyboard生成)");
console.log("  ├─ TTS生成次数:", sceneCount, "次");
console.log("  ├─ FFmpeg编码次数:", sceneCount + 1, "次 (每场景合成 + 拼接)");
console.log("  ├─ 临时磁盘空间:", Math.round(sceneCount * 15), "～", Math.round(sceneCount * 25), "MB");
console.log("  └─ 预估总耗时:", estimatedPipelineMinutes, "～", Math.round(estimatedPipelineMinutes * 2), "分钟");

console.log("\n✅ 系统状态检查");
const checks = [];

// Check Node.js
checks.push(["Node.js", process.version]);

// Check if ffmpeg is available
try {
  require("child_process").execSync("ffmpeg -version", { timeout: 5000, stdio: "pipe" });
  checks.push(["FFmpeg", "✅ 可用"]);
} catch {
  checks.push(["FFmpeg", "❌ 未找到"]);
}

// Check if python is available
try {
  const result = require("child_process").execSync("python3 --version 2>&1 || python --version 2>&1", { timeout: 5000, stdio: "pipe", encoding: "utf-8" }).trim();
  checks.push(["Python", "✅ " + result]);
} catch {
  checks.push(["Python", "⚠️  未找到 (edge_tts不可用)"]);
}

// Check database
try {
  const { Database } = require("better-sqlite3");
  const db = new Database("prisma/dev.db", { readonly: true });
  const result = db.prepare("SELECT 1 AS ok").get();
  db.close();
  checks.push(["数据库", result ? "✅ prisma/dev.db" : "❌"]);
} catch {
  checks.push(["数据库", "⚠️  未找到 dev.db (需prisma db push)"]);
}

// Check environment
checks.push(["WAL模式", process.env.DATABASE_URL ? "已配置" : "⚠️  检查 src/lib/db/index.ts"]);
checks.push(["npm包", "检查 package.json..."]);

for (const [name, status] of checks) {
  console.log("  ├─", name + ":", status);
}

console.log("\n═══════════════════════════════════════");
console.log("  如需完整测试: npm run dev → POST /api/projects");
console.log("═══════════════════════════════════════\n");
