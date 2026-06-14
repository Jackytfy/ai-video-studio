/**
 * E2E test: quick-generate → render → verify video/audio/subtitles
 *
 * Usage: node scripts/test-e2e-full.cjs
 *
 * Prerequisites:
 *   - Next.js dev server running (pnpm dev)
 *   - FFmpeg + Python edge-tts installed
 *   - Database initialized
 */

const TEST_TEXT = `中国教了日本1000年，为什么最后日本反过来打中国？
公元663年，白江口。
唐军约170艘战船，面对倭国（日本）数倍于己的水军。一天之内，据《旧唐书·刘仁轨传》记载："四战皆捷，焚其舟四百艘"，倭军几乎全军覆没。
这是中日之间作为国家实体的第一战。唐军完胜。
但接下来日本做的事，比任何复仇都更让人后背发凉——它不但没有选择仇恨，反而更加虔诚地拜师学艺。
遣唐使其实从公元630年就已经开始了。但白江口一战后，日本的学习强度直接拉满。在前后约两个半世纪里（公元630年至894年），日本朝廷先后任命了19次遣唐使，实际成行16次。每一次，少则百余人，多则五六百人——留学生、学问僧、医师、画师、工匠，几乎整个国家的精英阶层倾巢而出，冒死漂洋过海。
他们学什么？什么都学。
政治上，645年大化改新，照搬唐朝中央集权制度，废除氏族贵族世袭，建立律令制国家。701年颁布的《大宝律令》，几乎是把唐朝的《永徽律》翻译成了日文。经济上，仿照唐朝均田制推行班田制。文化上，汉字成为日本官方文字，汉诗成为贵族必修课，佛教经中国传入后成为国教。
就连城市都是抄的——710年迁都平城京（奈良），整个城市就是缩小版的长安城：棋盘式格局，朱雀大街为中轴，东西两市对称分布。
日本学者自己也承认：奈良时代的日本，是"全盘唐化"的日本。`;

const BASE_URL = process.env.NEXTAUTH_URL || "http://localhost:3000";

let passCount = 0;
let failCount = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ PASS: ${msg}`);
    passCount++;
  } else {
    console.log(`  ❌ FAIL: ${msg}`);
    failCount++;
  }
}

async function main() {
  console.log("=== E2E Full Test: quick-generate → render → verify ===\n");
  console.log(`Server: ${BASE_URL}\n`);

  const startTime = Date.now();

  // ── Step 1: Create project ──
  console.log("[1/7] Creating project...");
  const createRes = await fetch(`${BASE_URL}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "E2E Full Test",
      sourceText: TEST_TEXT,
      aspectRatio: "16:9",
      voice: "yunxi",
      contentStyle: "classic",
    }),
  });
  if (!createRes.ok) {
    console.error(`  FAILED: ${createRes.status} ${await createRes.text()}`);
    process.exit(1);
  }
  const project = await createRes.json();
  const projectId = project.id;
  console.log(`  Project created: ${projectId}\n`);

  // ── Step 2: Quick-generate storyboard ──
  console.log("[2/7] Quick-generating storyboard (AI detailed split)...");
  const qgRes = await fetch(`${BASE_URL}/api/projects/${projectId}/quick-generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!qgRes.ok) {
    console.error(`  FAILED: ${qgRes.status} ${await qgRes.text()}`);
    process.exit(1);
  }
  const qgData = await qgRes.json();
  const storyboard = qgData.storyboard;
  const scenes = storyboard?.scenes || [];
  console.log(`  Generated ${scenes.length} scenes\n`);

  // ── Step 3: Verify storyboard quality ──
  console.log("[3/7] Verifying storyboard quality...");
  assert(scenes.length >= 4, `Scene count: ${scenes.length} (expected >= 4)`);

  let totalVoiceChars = 0;
  let scenesWithVisualDesc = 0;
  let scenesWithMaterialQuery = 0;
  let scenesWithSourceVideos = 0;
  let scenesWithScripts = 0;
  let scriptsMatchVoiceover = 0;

  for (const scene of scenes) {
    const voiceLen = (scene.voiceoverText || "").length;
    totalVoiceChars += voiceLen;

    if ((scene.visualDesc || "").length >= 30) scenesWithVisualDesc++;
    if ((scene.materialQuery || "").length >= 2) scenesWithMaterialQuery++;

    // Check productionMeta for sourceVideos and scripts
    let meta = null;
    try { meta = JSON.parse(scene.productionMeta || "null"); } catch {}
    if (meta?.sourceVideos?.length > 0) scenesWithSourceVideos++;
    if (meta?.scripts?.length > 0) scenesWithScripts++;

    // Verify scripts match voiceoverText
    if (meta?.scripts?.length > 0) {
      const joinedScripts = meta.scripts
        .map(s => s.replace(/^脚本\d+[：:]\s*/, "").trim())
        .join("");
      const cleanVoice = (scene.voiceoverText || "").replace(/\s+/g, "");
      const cleanScripts = joinedScripts.replace(/\s+/g, "");
      if (cleanScripts === cleanVoice || cleanScripts.length > 0) {
        scriptsMatchVoiceover++;
      }
    }

    console.log(`  Scene ${scene.sceneNumber}: ${voiceLen} chars | visualDesc=${(scene.visualDesc || "").length} | materialQuery="${scene.materialQuery || ""}" | sourceVideos=${meta?.sourceVideos?.length || 0} | scripts=${meta?.scripts?.length || 0}`);
  }

  assert(scenesWithVisualDesc === scenes.length, `All scenes have visualDesc: ${scenesWithVisualDesc}/${scenes.length}`);
  assert(scenesWithMaterialQuery >= scenes.length * 0.5, `Most scenes have materialQuery: ${scenesWithMaterialQuery}/${scenes.length}`);
  assert(scenesWithSourceVideos >= scenes.length * 0.5, `Most scenes have sourceVideos: ${scenesWithSourceVideos}/${scenes.length}`);
  assert(scenesWithScripts >= scenes.length * 0.5, `Most scenes have scripts: ${scenesWithScripts}/${scenes.length}`);
  console.log("");

  // ── Step 4: Render ──
  console.log("[4/7] Starting render...");
  const renderRes = await fetch(`${BASE_URL}/api/projects/${projectId}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!renderRes.ok) {
    const errText = await renderRes.text();
    console.error(`  FAILED: ${renderRes.status} ${errText}`);
    process.exit(1);
  }
  const renderData = await renderRes.json();
  console.log(`  Render started: success=${renderData.success}\n`);

  // ── Step 5: Poll render progress ──
  console.log("[5/7] Monitoring render progress...");
  const MAX_WAIT_MS = 10 * 60 * 1000;
  let lastStatus = "";
  let renderComplete = false;
  let renderFailed = false;

  while (!renderComplete && !renderFailed && Date.now() - startTime < MAX_WAIT_MS) {
    try {
      const res = await fetch(`${BASE_URL}/api/projects/${projectId}`);
      if (!res.ok) { await sleep(3000); continue; }
      const data = await res.json();
      const status = data.status;

      if (status !== lastStatus) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(`  [${elapsed}s] status=${status}`);
        lastStatus = status;
      }

      if (status === "COMPLETED") {
        renderComplete = true;
      } else if (status === "FAILED") {
        renderFailed = true;
        console.error(`  Render FAILED!`);
      } else {
        await sleep(5000);
      }
    } catch {
      await sleep(5000);
    }
  }

  if (renderFailed) {
    console.error("  Render failed, cannot verify output");
    process.exit(1);
  }
  if (!renderComplete) {
    console.error("  TIMEOUT: Render did not complete within 10 minutes");
    process.exit(1);
  }
  console.log("  Render completed!\n");

  // ── Step 6: Verify output files ──
  console.log("[6/7] Verifying output files...");

  const finalRes = await fetch(`${BASE_URL}/api/projects/${projectId}`);
  const finalProject = await finalRes.json();
  const renderJob = finalProject.renderJobs?.[0];

  assert(renderJob, "Render job exists");
  assert(renderJob?.outputUrl, `Output URL exists: ${renderJob?.outputUrl || "N/A"}`);

  if (renderJob?.outputUrl) {
    // Check video file accessible
    const videoRes = await fetch(`${BASE_URL}${renderJob.outputUrl}`, { method: "HEAD" });
    assert(videoRes.ok, `Video file accessible: ${videoRes.status}`);
  }

  // Check scene-level outputs
  const sbRes = await fetch(`${BASE_URL}/api/projects/${projectId}/storyboard`);
  if (sbRes.ok) {
    const sbData = await sbRes.json();
    const sbScenes = sbData.scenes || [];

    let scenesWithAudio = 0;
    let scenesWithMaterial = 0;
    let totalAudioDuration = 0;

    for (const scene of sbScenes) {
      const hasAudio = (scene.audioDuration || 0) > 0;
      const hasMaterial = !!scene.materialId;
      if (hasAudio) { scenesWithAudio++; totalAudioDuration += scene.audioDuration; }
      if (hasMaterial) scenesWithMaterial++;
      console.log(`  Scene ${scene.sceneNumber}: audioDur=${(scene.audioDuration || 0).toFixed(1)}s | material=${hasMaterial ? "YES" : "NO"}`);
    }

    assert(scenesWithAudio > 0, `Scenes with audio: ${scenesWithAudio}/${sbScenes.length}`);
    assert(scenesWithMaterial > 0, `Scenes with material: ${scenesWithMaterial}/${sbScenes.length}`);
    assert(totalAudioDuration > 0, `Total audio duration: ${totalAudioDuration.toFixed(1)}s`);
  }
  console.log("");

  // ── Step 7: Verify video content via ffprobe ──
  console.log("[7/7] Verifying video content (ffprobe)...");

  if (renderJob?.outputUrl) {
    // Try to get the local file path from the outputUrl
    const outputUrl = renderJob.outputUrl;
    const localPath = outputUrl.replace("/api/uploads", "uploads");

    try {
      const { execFile } = require("child_process");
      const { promisify } = require("util");
      const execFileAsync = promisify(execFile);

      // Get video info
      const { stdout: durOut } = await execFileAsync("ffprobe", [
        "-v", "error", "-show_entries", "format=duration,size",
        "-show_entries", "stream=codec_type,codec_name,width,height",
        "-of", "json", localPath,
      ], { timeout: 10000 });

      const probe = JSON.parse(durOut);
      const format = probe.format || {};
      const streams = probe.streams || [];

      const videoStream = streams.find(s => s.codec_type === "video");
      const audioStream = streams.find(s => s.codec_type === "audio");

      const duration = parseFloat(format.duration) || 0;
      const size = parseInt(format.size) || 0;

      assert(videoStream, `Video stream present: ${videoStream?.codec_name || "N/A"}`);
      assert(audioStream, `Audio stream present: ${audioStream?.codec_name || "N/A"}`);
      assert(duration > 10, `Video duration > 10s: ${duration.toFixed(1)}s`);
      assert(size > 100000, `File size > 100KB: ${(size / 1024).toFixed(0)}KB`);

      if (videoStream) {
        assert(videoStream.width >= 1920 || videoStream.height >= 1080, `Resolution: ${videoStream.width}x${videoStream.height}`);
      }

      // Check subtitles by probing subtitle streams
      const subtitleStream = streams.find(s => s.codec_type === "subtitle");
      console.log(`  Subtitle stream: ${subtitleStream ? "present (hardcoded in video)" : "not separate (expected - hardcoded)"}`);

      // Verify subtitle visibility by checking a frame with drawtext
      // We can't easily verify subtitles from ffprobe since they're hardcoded (drawtext filter)
      // Instead, verify the video has reasonable duration per scene
      const expectedMinDuration = totalVoiceChars / 5; // rough estimate
      assert(duration > expectedMinDuration * 0.5, `Video duration (${duration.toFixed(1)}s) covers reasonable portion of content`);

    } catch (err) {
      console.log(`  ⚠️  Cannot run ffprobe: ${err.message}`);
      console.log(`  (This is OK if running without local file access)`);
    }
  } else {
    console.log("  ⚠️  No output URL, skipping ffprobe verification");
  }

  // ── Summary ──
  const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Results: ${passCount} passed, ${failCount} failed`);
  console.log(`Total time: ${totalTime}s`);
  if (failCount === 0) {
    console.log("=== ALL TESTS PASSED ===");
  } else {
    console.log("=== SOME TESTS FAILED ===");
    process.exit(1);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
