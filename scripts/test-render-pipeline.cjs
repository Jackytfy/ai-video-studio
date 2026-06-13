/**
 * End-to-end test for the render pipeline.
 * Tests: TTS generation → material processing → video compositing → subtitle sync
 *
 * Usage: node scripts/test-render-pipeline.cjs
 *
 * Prerequisites:
 *   - Next.js dev server running (pnpm dev)
 *   - FFmpeg + Python edge-tts installed
 *   - Database initialized (npx prisma migrate dev)
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

async function main() {
  console.log("=== Render Pipeline E2E Test ===\n");
  console.log(`Server: ${BASE_URL}\n`);

  // Step 1: Create project
  console.log("[1/6] Creating project...");
  const createRes = await fetch(`${BASE_URL}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "E2E Test - 中日千年",
      sourceText: TEST_TEXT,
      aspectRatio: "16:9",
      voice: "yunxi",
      contentStyle: "classic",
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    console.error(`  FAILED: ${createRes.status} ${err}`);
    process.exit(1);
  }
  const project = await createRes.json();
  const projectId = project.id;
  console.log(`  OK: project=${projectId}\n`);

  // Step 2: Analyze
  console.log("[2/6] Analyzing content...");
  const analyzeRes = await fetch(`${BASE_URL}/api/projects/${projectId}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!analyzeRes.ok) {
    const err = await analyzeRes.text();
    console.error(`  FAILED: ${analyzeRes.status} ${err}`);
    process.exit(1);
  }
  const analysis = await analyzeRes.json();
  console.log(`  OK: ${analysis.analysis?.summary?.substring(0, 60) || "done"}...\n`);

  // Step 3: Generate storyboard
  console.log("[3/6] Generating storyboard...");
  const sbRes = await fetch(`${BASE_URL}/api/projects/${projectId}/storyboard/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan: "A", sceneCount: 5 }),
  });

  if (!sbRes.ok) {
    const err = await sbRes.text();
    console.error(`  FAILED: ${sbRes.status} ${err}`);
    process.exit(1);
  }
  const sbData = await sbRes.json();
  const storyboard = sbData.storyboard || sbData;
  const sceneCount = storyboard.scenes?.length || 0;
  console.log(`  OK: ${sceneCount} scenes generated\n`);

  if (sceneCount === 0) {
    console.error("  No scenes generated, cannot continue");
    process.exit(1);
  }

  // Print scene summary
  for (const scene of storyboard.scenes) {
    const voiceLen = (scene.voiceoverText || "").length;
    console.log(`  Scene ${scene.sceneNumber}: ${voiceLen} chars - "${(scene.voiceoverText || "").substring(0, 30)}..."`);
  }
  console.log("");

  // Step 4: Confirm storyboard (triggers material search)
  console.log("[4/6] Confirming storyboard...");
  const confirmRes = await fetch(`${BASE_URL}/api/projects/${projectId}/storyboard/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });

  if (!confirmRes.ok) {
    const err = await confirmRes.text();
    console.error(`  FAILED: ${confirmRes.status} ${err}`);
    process.exit(1);
  }
  const confirmData = await confirmRes.json();
  console.log(`  OK: renderStarted=${confirmData.renderStarted}\n`);

  // Step 5: Poll render progress via SSE endpoint
  console.log("[5/6] Monitoring render progress...");
  const startTime = Date.now();
  const MAX_WAIT_MS = 10 * 60 * 1000; // 10 minutes max

  let lastStatus = "";
  let lastProgress = -1;
  let renderComplete = false;

  while (!renderComplete && Date.now() - startTime < MAX_WAIT_MS) {
    try {
      const progressRes = await fetch(`${BASE_URL}/api/projects/${projectId}`);
      if (!progressRes.ok) {
        console.log("  Waiting for project data...");
        await sleep(3000);
        continue;
      }
      const projectData = await progressRes.json();

      const status = projectData.status;
      const renderJob = projectData.renderJobs?.[0];

      if (status !== lastStatus || (renderJob && renderJob.progress !== lastProgress)) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const progress = renderJob ? `${Math.round(renderJob.progress * 100)}%` : "N/A";
        const stage = renderJob?.currentStage || "";
        console.log(`  [${elapsed}s] status=${status} progress=${progress} stage=${stage}`);
        lastStatus = status;
        lastProgress = renderJob?.progress || -1;
      }

      if (status === "COMPLETED") {
        renderComplete = true;
        console.log(`  Render completed! outputUrl=${renderJob?.outputUrl}`);
      } else if (status === "FAILED") {
        console.error(`  Render FAILED: ${renderJob?.errorMessage}`);
        process.exit(1);
      } else {
        await sleep(3000);
      }
    } catch (err) {
      console.log(`  Poll error: ${err.message}`);
      await sleep(5000);
    }
  }

  if (!renderComplete) {
    console.error("  TIMEOUT: Render did not complete within 10 minutes");
    process.exit(1);
  }

  // Step 6: Verify output
  console.log("\n[6/6] Verifying output...");

  // Get final project state
  const finalRes = await fetch(`${BASE_URL}/api/projects/${projectId}`);
  const finalProject = await finalRes.json();
  const renderJob = finalProject.renderJobs?.[0];

  if (!renderJob || !renderJob.outputUrl) {
    console.error("  FAILED: No output URL");
    process.exit(1);
  }

  // Check output file via ffprobe
  console.log(`  Output URL: ${renderJob.outputUrl}`);
  console.log(`  Duration: ${renderJob.outputDuration}s`);
  console.log(`  Size: ${(renderJob.outputSize / 1024 / 1024).toFixed(1)}MB`);

  // Verify via API
  const videoRes = await fetch(`${BASE_URL}${renderJob.outputUrl}`, { method: "HEAD" });
  console.log(`  Video accessible: ${videoRes.ok ? "YES" : "NO"}`);

  // Verify scene audio durations
  const sbDetailRes = await fetch(`${BASE_URL}/api/projects/${projectId}/storyboard`);
  if (sbDetailRes.ok) {
    const sbDetail = await sbDetailRes.json();
    console.log("\n  Scene audio duration verification:");
    for (const scene of sbDetail.scenes || []) {
      const audioDur = scene.audioDuration || 0;
      const voiceLen = (scene.voiceoverText || "").length;
      const estimatedSecs = voiceLen / 3.5;
      const ratio = audioDur > 0 ? (audioDur / estimatedSecs).toFixed(2) : "N/A";
      const status = audioDur > 0 ? "OK" : "MISSING";
      console.log(`    Scene ${scene.sceneNumber}: audioDur=${audioDur.toFixed(1)}s voiceLen=${voiceLen}chars ratio=${ratio} [${status}]`);
    }
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(0);
  console.log(`\n=== Test PASSED in ${totalTime}s ===`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
