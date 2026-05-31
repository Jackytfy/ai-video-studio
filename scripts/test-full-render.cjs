/**
 * 端到端测试：创建 → 分镜 → 渲染 → 验证视频
 */
const BASE = "http://localhost:3000";
const SCRIPT = `从北平藩王到永乐大帝
朱棣的起点，并不低。

十一岁封燕王，二十一岁就藩北平。驻守北疆，直面蒙古残部。据《明史·成祖本纪》记载，朱棣早年屡次随大将军出塞作战，"威震漠北"——在实战中练出了一身打仗的本事。

但问题是：皇位跟他没关系。

朱元璋立的太子是朱标，朱标死后立的是朱标的儿子朱允炆。朱棣不过是藩王中最能打的那一个——是拱卫北疆的一把刀。

直到朱允炆削藩。`;

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  全流程渲染测试");
  console.log("═══════════════════════════════════════\n");

  // Step 1: Create project
  console.log("[1/5] 创建项目...");
  const createRes = await fetch(`${BASE}/api/projects`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "朱棣测试", sourceText: SCRIPT, aspectRatio: "16:9", voice: "yunxi", contentStyle: "classic" }),
  });
  if (!createRes.ok) throw new Error(`创建失败: ${createRes.status}`);
  const project = await createRes.json();
  console.log(`  ✅ 项目: ${project.id}`);

  // Step 2: Generate storyboard
  console.log("\n[2/5] 生成分镜...");
  const t0 = Date.now();
  const genRes = await fetch(`${BASE}/api/projects/${project.id}/quick-generate`, { method: "POST" });
  if (!genRes.ok) throw new Error(`分镜失败: ${genRes.status}`);
  console.log(`  ✅ 完成 (${((Date.now()-t0)/1000).toFixed(1)}s)`);

  // Get storyboard details
  const sbRes = await fetch(`${BASE}/api/projects/${project.id}/storyboard`);
  const sb = await sbRes.json();
  console.log(`  场景数: ${sb.totalScenes}`);
  for (const s of sb.scenes) {
    const meta = s.productionMeta ? JSON.parse(s.productionMeta) : null;
    console.log(`    场景${s.sceneNumber}【${s.title}】${meta?.scripts?.length || 0}条脚本 | materialQuery: ${(s.materialQuery||"").slice(0,40)}`);
  }

  // Step 3: Confirm storyboard (required before render)
  console.log("\n[3/5] 确认分镜...");
  const confirmRes = await fetch(`${BASE}/api/projects/${project.id}/storyboard/confirm`, { method: "POST" });
  if (!confirmRes.ok) { const er = await confirmRes.text(); console.log(`  ⚠️ 确认状态: ${confirmRes.status} ${er.slice(0,100)}`); }

  // Step 4: Render
  console.log("\n[4/5] 开始渲染（自动搜索Bilibili素材）...");
  const t2 = Date.now();
  const renderRes = await fetch(`${BASE}/api/projects/${project.id}/render`, {
    method: "POST",
    signal: AbortSignal.timeout(600000), // 10 min timeout
  });

  if (!renderRes.ok) {
    const errText = await renderRes.text();
    console.log(`  ❌ 渲染失败: ${renderRes.status} ${errText.slice(0,300)}`);
    throw new Error("渲染失败");
  }
  
  const renderData = await renderRes.json();
  const elapsed = ((Date.now() - t2) / 1000).toFixed(1);
  console.log(`  ✅ 渲染完成 (${elapsed}s)`);
  console.log(`  outputUrl: ${renderData.outputUrl}`);
  console.log(`  duration: ${renderData.duration}s`);

  // Step 5: Verify video
  console.log("\n[5/5] 验证输出视频...");
  const fullPath = `f:/创作/20260512/ai-video-studio/uploads/${project.id}/output/${renderData.outputUrl.split("/").pop()}`;
  
  const { execFileSync } = require("child_process");
  let probeResult = "";
  try {
    probeResult = execFileSync("ffprobe", [
      "-v", "error",
      "-show_entries", "stream=codec_type,width,height,bit_rate,nb_frames",
      "-show_entries", "format=duration,bit_rate",
      "-of", "default=noprint_wrappers=1",
      fullPath,
    ], { encoding: "utf8", timeout: 10000 });
  } catch (e) {
    console.log(`  ffprobe 失败: ${e.message}`);
  }

  console.log(`  ${probeResult.replace(/\n/g, "\n  ")}`);

  // Check if video has real content (not just solid color)
  if (probeResult.includes("codec_type=video") && probeResult.includes("bit_rate")) {
    const videoBitrate = probeResult.match(/codec_type=video[\s\S]*?bit_rate=(\d+)/);
    if (videoBitrate && parseInt(videoBitrate[1]) > 100000) {
      console.log(`  ✅ 视频码率正常 (>100kbps)，应有真实画面`);
    } else if (videoBitrate) {
      console.log(`  ⚠️ 视频码率偏低 (${videoBitrate[1]}bps)，可能仍是纯色占位`);
    }
  }

  console.log("\n═══════════════════════════════════════");
  console.log("  测试完成");
  console.log(`  视频路径: ${fullPath}`);
  console.log("═══════════════════════════════════════\n");
}

main().catch(e => { console.error("\n❌", e.message); process.exit(1); });
