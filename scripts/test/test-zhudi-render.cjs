/**
 * 朱棣脚本全流程渲染测试
 */
const BASE = "http://localhost:3000";
const SCRIPT = `比朱元璋还狠的地方
前面说的是功业。现在说狠。

朱棣的狠，有三件事绕不过去。

第一件：诛方孝孺十族。

方孝孺是建文旧臣之首。朱棣让他写即位诏书，方孝孺不写，反而骂朱棣"燕贼篡位"。朱棣说："你不怕我诛你九族吗？"方孝孺回："诛十族又如何？"

据《明史·方孝孺传》记载，朱棣真的诛了方孝孺十族。 九族不够，加上学生——一共八百七十三人。

第二件：设东厂。

朱元璋设了锦衣卫，够狠了。朱棣觉得不够——他在锦衣卫之上又架了一个东厂，由太监掌管，专门监控锦衣卫。

两层特务机构互相监控——整个明朝的官场，从此活在被监视的恐惧中。

第三件：连自己的儿子都不信。

朱棣的长子朱高炽，性格宽厚，不太像他。朱棣一度想废掉太子，立更像自己的次子朱高煦。父子之间的猜忌持续了十几年。

对外人狠，对自己人也狠——甚至对自己的继承人，他都不完全信任。`;

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { headers: { "Content-Type": "application/json" }, ...opts });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  console.log("═══ 朱棣脚本全流程渲染测试 ═══\n");

  // Step 1: Create project
  console.log("[1/4] 创建项目...");
  const c = await req("/api/projects", {
    method: "POST",
    body: JSON.stringify({ name: "朱棣的狠", sourceText: SCRIPT, aspectRatio: "16:9", voice: "yunxi", contentStyle: "classic" }),
  });
  if (!c.ok) { console.log(`FAIL: ${c.status}`, JSON.stringify(c.data).slice(0, 200)); return; }
  const pid = c.data.id;
  console.log(`  ✅ ${pid}`);

  // Step 2: Generate storyboard
  console.log("[2/4] 生成分镜...");
  const t0 = Date.now();
  const g = await req(`/api/projects/${pid}/quick-generate`, { method: "POST" });
  console.log(`  ${g.ok ? '✅' : '⚠️'} ${((Date.now()-t0)/1000).toFixed(1)}s`);

  // Get storyboard
  const sb = await req(`/api/projects/${pid}/storyboard`);
  const scenes = sb.data?.scenes || sb.data?.storyboard?.scenes || [];
  console.log(`  场景数: ${scenes.length}`);
  for (const s of scenes) {
    const meta = s.productionMeta ? JSON.parse(s.productionMeta) : null;
    const pnList = meta?.properNouns?.map(p => p.name).join(" ") || "";
    console.log(`    S${s.sceneNumber}【${s.title}】${meta?.scripts?.length||0}条脚本 | 专名: ${pnList.slice(0,40)}`);
    console.log(`      materialQuery: ${(s.materialQuery||'').slice(0,60)}`);
  }

  // Step 3: Confirm & render
  console.log("[3/4] 确认分镜...");
  await req(`/api/projects/${pid}/storyboard/confirm`, { method: "POST" });

  console.log("[4/4] 渲染中...");
  const t2 = Date.now();
  const r = await req(`/api/projects/${pid}/render`, { method: "POST" });
  const elapsed = ((Date.now()-t2)/1000).toFixed(1);

  if (!r.ok) {
    console.log(`  ❌ FAIL (${elapsed}s): ${r.status}`);
    console.log(`  ${JSON.stringify(r.data).slice(0, 300)}`);
    return;
  }

  console.log(`  ✅ OK (${elapsed}s)`);
  console.log(`  outputUrl: ${r.data.outputUrl}`);
  console.log(`  duration: ${r.data.duration}s`);

  // Verify video
  const videoFile = `f:/创作/20260512/ai-video-studio/uploads/${pid}/output/${r.data.outputUrl.split('/').pop()}`;
  const { execFileSync } = require("child_process");
  try {
    const probe = execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "stream=codec_type,width,height,bit_rate", "-of", "default",
      videoFile
    ], { encoding: "utf8" });
    console.log(`\n  视频信息:\n${probe.split('\n').filter(l=>l).map(l => '  ' + l).join('\n')}`);
  } catch(e) {
    console.log(`  ffprobe: ${e.message}`);
  }

  console.log(`\n  文件: ${videoFile}`);
}

main().catch(e => { console.error("ERR:", e.message); process.exit(1); });
