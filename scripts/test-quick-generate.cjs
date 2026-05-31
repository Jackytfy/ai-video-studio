/**
 * 自动化测试：quick-generate 语义拆分
 * 测试流程：创建项目 → 调用 quick-generate → 验证分镜结果
 *
 * 使用方法：node scripts/test-quick-generate.cjs
 */

const BASE = process.env.TEST_PORT ? `http://localhost:${process.env.TEST_PORT}` : "http://localhost:3002";

const TEST_TEXT = `人工智能正在改变我们的生活方式。从智能手机到自动驾驶，AI技术已经渗透到日常的方方面面。语音助手可以帮我们设置闹钟、播放音乐，甚至控制家电。这些便利让我们的生活更加高效。

然而，AI的快速发展也带来了不少隐忧。数据隐私问题日益突出，算法偏见可能导致不公平的决策。另外，自动化可能导致部分岗位消失，引发就业市场的结构性变化。

面对这些挑战，我们需要建立更加完善的监管框架。政府、企业和学术界需要通力合作，确保AI技术的发展方向是造福人类而非危害人类。透明度和可解释性将成为未来AI系统的核心要求。

展望未来，AI与人类的协作模式将成为主流。AI负责处理重复性、数据密集型的任务，人类则专注于创造性、战略性的工作。这种人机协作的新范式，将释放出前所未有的生产力。`;

async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  自动化测试：quick-generate 语义拆分");
  console.log("═══════════════════════════════════════\n");

  // ── Step 1: 创建项目 ──
  console.log("[1/4] 创建项目...");
  const createRes = await fetch(`${BASE}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "自动化测试-" + Date.now(),
      sourceText: TEST_TEXT,
      aspectRatio: "16:9",
      voice: "yunxi",
      contentStyle: "knowledge",
    }),
  });

  if (!createRes.ok) {
    throw new Error(`创建项目失败: ${createRes.status} ${await createRes.text()}`);
  }
  const project = await createRes.json();
  console.log(`   ✅ 项目已创建: ${project.id}`);
  console.log(`   名称: ${project.name}`);

  // ── Step 2: 调用 quick-generate ──
  console.log("\n[2/4] 调用 quick-generate（AI 语义拆分）...");
  const t0 = Date.now();
  const genRes = await fetch(`${BASE}/api/projects/${project.id}/quick-generate`, {
    method: "POST",
  });

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  if (!genRes.ok) {
    throw new Error(`quick-generate 失败: ${genRes.status} ${await genRes.text()}`);
  }
  const data = await genRes.json();
  console.log(`   ✅ quick-generate 完成 (耗时 ${elapsed}s)`);

  // ── Step 3: 获取分镜详情 ──
  console.log("\n[3/4] 获取分镜详情...");
  const sbRes = await fetch(`${BASE}/api/projects/${project.id}/storyboard`);
  if (!sbRes.ok) {
    throw new Error(`获取分镜失败: ${sbRes.status}`);
  }
  const storyboard = await sbRes.json();
  const method = JSON.parse(
    (await (await fetch(`${BASE}/api/projects/${project.id}`)).json()).aiAnalysis || "{}"
  ).splitMethod || "unknown";

  console.log(`   ✅ 分镜已获取`);
  console.log(`   拆分方式: ${method === "semantic" ? "🧠 AI 语义拆分" : "📄 段落拆分（兜底）"}`);
  console.log(`   场景总数: ${storyboard.totalScenes}`);
  console.log(`   预估时长: ${storyboard.totalDuration}s`);

  // ── Step 4: 验证结果 ──
  console.log("\n[4/4] 验证结果...\n");
  console.log("┌─────────────────────────────────────────┐");

  let totalChars = 0;
  const scenes = storyboard.scenes || [];
  for (const scene of scenes) {
    const preview = scene.voiceoverText.slice(0, 40).replace(/\n/g, " ");
    totalChars += (scene.wordCount || 0);
    console.log(`│ 场景${scene.sceneNumber.toString().padStart(2)} │ ${(scene.title || "—").padEnd(16)} │ ${scene.wordCount?.toString().padStart(3)}字 │ ${preview}...`);
  }

  console.log("├─────────────────────────────────────────┤");
  console.log(`│ 总计 │ ${scenes.length} 个场景 │ ${totalChars} 字 │ 拆分方式: ${method.padEnd(8)} │`);
  console.log("└─────────────────────────────────────────┘");

  // ── 断言 ──
  const assertions = [];
  if (scenes.length >= 2) {
    assertions.push(`✅ 场景数 ≥ 2 (${scenes.length})`);
  } else {
    assertions.push(`⚠️  场景数 = ${scenes.length}（可能只有1个段落）`);
  }
  if (totalChars >= TEST_TEXT.length * 0.9) {
    assertions.push(`✅ 文本覆盖度 ${((totalChars / TEST_TEXT.length) * 100).toFixed(0)}%`);
  } else {
    assertions.push(`❌ 文本覆盖度不足 ${((totalChars / TEST_TEXT.length) * 100).toFixed(0)}%`);
  }
  if (scenes.every(s => s.title)) {
    assertions.push("✅ 所有场景都有标题");
  } else {
    assertions.push("❌ 部分场景缺少标题");
  }
  if (scenes.every(s => s.wordCount > 0)) {
    assertions.push("✅ 所有场景都有字数统计");
  } else {
    assertions.push("❌ 部分场景缺少字数统计");
  }
  if (method === "semantic") {
    assertions.push("✅ 使用了 AI 语义拆分");
  } else {
    assertions.push("⚠️  回退到段落拆分（可能是 AI 超时或段落太少）");
  }

  console.log("\n断言结果：");
  for (const a of assertions) console.log(`  ${a}`);

  console.log("\n═══════════════════════════════════════");
  console.log("  测试完成");
  console.log("═══════════════════════════════════════\n");

  // Cleanup
  await fetch(`${BASE}/api/projects/${project.id}`, { method: "DELETE" }).catch(() => {});
  console.log("🧹 测试项目已清理\n");
}

main().catch((err) => {
  console.error("\n❌ 测试失败:", err.message);
  process.exit(1);
});
