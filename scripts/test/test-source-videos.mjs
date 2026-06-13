/**
 * Test: sourceVideos + materialQuery 提取逻辑
 */

// Inline extractChineseSearchQuery with new logic
function extractChineseSearchQuery(ctx) {
  const query = ctx.materialQuery || "";

  if (ctx.sourceVideos && ctx.sourceVideos.length > 0) {
    const source = ctx.sourceVideos[0];
    const parts = query.split(/[,，、\s]+/).filter(p => p.length >= 2);
    const core = parts.length >= 2 ? parts.slice(0, 2).join(" ") : query.substring(0, 15);
    return `${source} ${core}`;
  }

  if (query.length <= 20) return query;

  const abstractWords = new Set([
    "画面", "描述", "展现", "展示", "呈现", "表现", "体现", "反映",
    "风格", "色调", "氛围", "镜头", "光影", "构图", "采用", "运用",
    "使用", "适合", "需要", "可以", "强烈", "突出", "营造",
    "冷硬", "惨烈", "阴森", "压抑", "悲壮", "辉煌", "宏伟",
    "戏剧", "冲突", "悲剧", "色彩", "恐怖", "紧张", "庄严",
  ]);

  const concretePatterns = /朱[元棣标]|明朝|大明|永乐|洪武|紫禁城|宫殿|朝堂|战场|登基|靖难|削藩|方孝孺|东厂|锦衣卫|藩王|纪录片|电视剧|影视|战争|骑兵|冲锋|大殿|城墙|故宫|皇宫|南京|北平|蒙古|漠北|戈壁|边塞|郑和|下西洋|汉朝|唐朝|宋朝|清朝|三国|战国|秦朝|春秋/;
  const hasConcrete = concretePatterns.test(query);

  if (hasConcrete) {
    const matches = query.match(concretePatterns) || [];
    const unique = [...new Set(matches)].slice(0, 3);
    return unique.join(" ");
  }

  const parts = query.split(/[,，、。！？；\s]+/).filter(p => p.length >= 2 && p.length <= 10);
  if (parts.length > 0) {
    return parts.slice(0, 2).join(" ");
  }

  return query.substring(0, 15);
}

let passed = 0;
let failed = 0;

function assert(condition, name, actual) {
  if (condition) {
    console.log(`  ✅ ${name}`);
    passed++;
  } else {
    console.log(`  ❌ ${name}${actual ? ` (got: "${actual}")` : ""}`);
    failed++;
  }
}

// --- sourceVideos tests ---
console.log("\n[sourceVideos] 无 sourceVideos — 原逻辑不变");
const q1 = extractChineseSearchQuery({ sceneNumber: 1, materialQuery: "明朝朝堂议事 电视剧片段" });
assert(q1 === "明朝朝堂议事 电视剧片段", "短 query 原样返回", q1);

console.log("\n[sourceVideos] 有 sourceVideos — 拼接来源名");
const q2 = extractChineseSearchQuery({ sceneNumber: 2, materialQuery: "朱元璋登基 大殿", sourceVideos: ["大明王朝1566"] });
assert(q2 === "大明王朝1566 朱元璋登基 大殿", "拼接正确", q2);

console.log("\n[sourceVideos] 空数组 — 回退原逻辑");
const q3 = extractChineseSearchQuery({ sceneNumber: 3, materialQuery: "紫禁城太和殿 空镜", sourceVideos: [] });
assert(q3 === "紫禁城太和殿 空镜", "空数组回退", q3);

// --- materialQuery 提取测试 ---
console.log("\n[materialQuery] 过长段落 — 提取具体名词");
const q4 = extractChineseSearchQuery({
  sceneNumber: 4,
  materialQuery: "画面风格应具有强烈的戏剧冲突和悲剧色彩。色调在宫殿场景中冷硬，在刑场场景中惨烈。运用正反打特写镜头突出方孝孺的刚烈与朱棣的震怒"
});
assert(q4.includes("宫殿") || q4.includes("方孝孺") || q4.includes("朱棣"), "提取到具体名词", q4);
assert(q4.length <= 20, "长度合理", q4);

console.log("\n[materialQuery] 纯抽象描述 — 截断返回");
const q5 = extractChineseSearchQuery({
  sceneNumber: 5,
  materialQuery: "画面风格要突出监控与压抑。色调采用青灰、冷蓝，营造阴森、无孔不入的氛围"
});
assert(q5.length <= 20, "截断到合理长度", q5);

console.log("\n[materialQuery] 短 query — 原样返回");
const q6 = extractChineseSearchQuery({ sceneNumber: 6, materialQuery: "明朝朝堂议事" });
assert(q6 === "明朝朝堂议事", "短 query", q6);

console.log("\n[materialQuery] 有具体名词的段落 — 提取具体词");
const q7 = extractChineseSearchQuery({
  sceneNumber: 7,
  materialQuery: "画面风格侧重内心戏与权力亲情的矛盾。色调在宫殿内为冷金色调，在表现父子关系时可用暖光但笼罩阴影。多用暗示性镜头：如两个儿子截然不同的画像"
});
assert(q7.includes("宫殿"), "包含具体词", q7);

// --- Summary ---
console.log(`\n${"=".repeat(40)}`);
console.log(`结果: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
