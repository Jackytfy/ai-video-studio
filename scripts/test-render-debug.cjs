/**
 * 分步调试渲染测试
 */
const BASE = "http://localhost:3000";
const SCRIPT = `从北平藩王到永乐大帝
朱棣的起点，并不低。

十一岁封燕王，二十一岁就藩北平。驻守北疆，直面蒙古残部。据《明史·成祖本纪》记载，朱棣早年屡次随大将军出塞作战，"威震漠北"——在实战中练出了一身打仗的本事。

但问题是：皇位跟他没关系。

朱元璋立的太子是朱标，朱标死后立的是朱标的儿子朱允炆。朱棣不过是藩王中最能打的那一个——是拱卫北疆的一把刀。

直到朱允炆削藩。`;

async function req(path, opts = {}) {
  const res = await fetch(`${BASE}${path}`, { headers: { "Content-Type": "application/json" }, ...opts });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  // Step 1: Create
  console.log("1 创建...");
  const c = await req("/api/projects", { method: "POST", body: JSON.stringify({ name: "朱棣测试", sourceText: SCRIPT, aspectRatio: "16:9", voice: "yunxi", contentStyle: "classic" }) });
  if (!c.ok) { console.log("FAIL:", c.status, JSON.stringify(c.data).slice(0, 200)); return; }
  const pid = c.data.id;
  console.log(`  OK: ${pid}`);

  // Step 2: Generate storyboard
  console.log("2 分镜...");
  const g = await req(`/api/projects/${pid}/quick-generate`, { method: "POST" });
  if (!g.ok) { console.log("FAIL:", g.status, JSON.stringify(g.data).slice(0, 200)); return; }
  console.log("  OK");

  // Step 3: Get storyboard
  const s = await req(`/api/projects/${pid}/storyboard`);
  const scenes = s.data.scenes || [];
  console.log(`  场景: ${scenes.length}`);
  for (const sc of scenes) {
    const meta = sc.productionMeta ? JSON.parse(sc.productionMeta) : null;
    console.log(`    S${sc.sceneNumber} | ${sc.title} | ${meta?.scripts?.length || 0} scripts | Q: ${(sc.materialQuery||'').slice(0,50)}`);
  }

  // Step 4: Confirm
  console.log("3 确认...");
  const cf = await req(`/api/projects/${pid}/storyboard/confirm`, { method: "POST" });
  console.log(`  ${cf.ok ? 'OK' : `FAIL: ${cf.status}`}`);

  // Step 5: Render (long timeout)
  console.log("4 渲染(等待中)...");
  const start = Date.now();
  const r = await req(`/api/projects/${pid}/render`, { method: "POST" });
  const elapsed = ((Date.now()-start)/1000).toFixed(1);

  if (!r.ok) {
    console.log(`  FAIL (${elapsed}s): ${r.status}`);
    console.log(`  Error: ${JSON.stringify(r.data).slice(0, 500)}`);
    
    // Check render jobs for error detail
    const jobs = await req(`/api/projects/${pid}/render/status`);
    console.log(`  RenderJobs: ${JSON.stringify(jobs.data).slice(0, 500)}`);
    return;
  }

  console.log(`  OK (${elapsed}s)`);
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
    console.log(`\n  视频信息:\n${probe.split('\n').map(l => '  ' + l).join('\n')}`);
  } catch(e) {
    console.log(`  ffprobe: ${e.message}`);
  }

  console.log(`\n  文件: ${videoFile}`);
}

main().catch(e => { console.error("ERR:", e.message); process.exit(1); });
