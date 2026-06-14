/**
 * 素材搜索匹配度测试
 *
 * 验证：搜索结果是否来自推荐的电视剧/纪录片，而非不相关内容
 *
 * Usage: node scripts/test-material-match.cjs
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
  console.log("=== 素材搜索匹配度测试 ===\n");

  // Step 1: 创建项目
  console.log("Step 1: 创建项目...");
  const createRes = await fetch(`${BASE_URL}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "素材匹配测试",
      sourceText: TEST_TEXT,
      aspectRatio: "16:9",
      voice: "yunxi",
      contentStyle: "classic",
    }),
  });
  if (!createRes.ok) {
    console.error(`  创建失败: ${createRes.status} ${await createRes.text()}`);
    process.exit(1);
  }
  const project = await createRes.json();
  const projectId = project.id;
  console.log(`  项目ID: ${projectId}`);
  assert(projectId, "项目创建成功");

  // Step 2: Quick-generate 分镜
  console.log("\nStep 2: 生成分镜...");
  const genRes = await fetch(`${BASE_URL}/api/projects/${projectId}/quick-generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const genData = await genRes.json();
  const storyboard = genData.storyboard;
  const scenes = storyboard?.scenes || [];
  assert(scenes.length > 0, `分镜生成: ${scenes.length} 个场景`);

  // Step 3: 检查每个场景的 sourceVideos 和 materialQuery
  console.log("\nStep 3: 检查分镜素材推荐...");
  for (let idx = 0; idx < scenes.length; idx++) {
    const s = scenes[idx];
    let meta = {};
    try { meta = JSON.parse(s.productionMeta || "{}"); } catch {}
    const sourceVideos = meta.sourceVideos || [];
    const materialQuery = meta.materialQuery || "";
    console.log(`  场景${idx}: sourceVideos=${JSON.stringify(sourceVideos)}, materialQuery="${materialQuery}"`);
    assert(sourceVideos.length > 0, `场景${idx} 有推荐影视来源`);
    assert(materialQuery.length > 0, `场景${idx} 有检索词`);
  }

  // Step 4: 触发渲染
  console.log("\nStep 4: 触发渲染...");
  const renderRes = await fetch(`${BASE_URL}/api/projects/${projectId}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  const renderData = await renderRes.json();
  console.log(`  渲染响应: ${JSON.stringify(renderData).slice(0, 100)}`);

  // Step 5: 等待渲染完成
  console.log("\nStep 5: 等待渲染完成...");
  let renderComplete = false;
  let renderStatus = "";
  for (let attempt = 0; attempt < 120; attempt++) {
    await new Promise(r => setTimeout(r, 5000));
    const statusRes = await fetch(`${BASE_URL}/api/projects/${projectId}`);
    const statusData = await statusRes.json();
    renderStatus = statusData.renderStatus || statusData.status || "";
    if (renderStatus === "COMPLETED") {
      renderComplete = true;
      break;
    }
    if (renderStatus === "FAILED") {
      console.log(`  渲染失败!`);
      break;
    }
    if (attempt % 6 === 0) {
      console.log(`  等待中... 状态: ${renderStatus} (${attempt * 5}s)`);
    }
  }
  assert(renderComplete, `渲染完成 (状态: ${renderStatus})`);

  if (!renderComplete) {
    console.log("\n=== 测试结果 ===");
    console.log(`通过: ${passCount}, 失败: ${failCount}`);
    process.exit(1);
  }

  // Step 6: 检查每个场景匹配的素材是否来自推荐的 sourceVideos
  console.log("\nStep 6: 验证素材匹配度...");
  const { PrismaClient } = require("../node_modules/.prisma/client");
  const prisma = new PrismaClient();

  try {
    const dbScenes = await prisma.scene.findMany({
      where: { storyboard: { projectId } },
      include: { material: true },
      orderBy: { order: "asc" },
    });

    let totalScenes = dbScenes.length;
    let matchedFromSource = 0;
    let matchedFromOther = 0;
    let noMaterial = 0;

    for (let idx = 0; idx < dbScenes.length; idx++) {
      const s = dbScenes[idx];
      let meta = {};
      try { meta = JSON.parse(s.productionMeta || "{}"); } catch {}
      const sourceVideos = meta.sourceVideos || [];
      const material = s.material;

      if (!material) {
        noMaterial++;
        console.log(`  场景${idx}: ❌ 无素材`);
        continue;
      }

      const title = material.name || "";
      const searchQuery = material.searchQuery || "";
      const source = material.externalSource || "";

      // 检查素材标题是否包含推荐的 sourceVideos 中的剧名
      let isFromSource = false;
      for (const sv of sourceVideos) {
        const svClean = sv.replace(/[\s【】\[\]「」『』]/g, "");
        const titleClean = title.replace(/[\s【】\[\]「」『』]/g, "");
        // 完整匹配或半匹配
        if (titleClean.includes(svClean)) {
          isFromSource = true;
          break;
        }
        // 缩写匹配
        const abbr1 = svClean.slice(0, Math.ceil(svClean.length / 2));
        const abbr2 = svClean.slice(-Math.ceil(svClean.length / 2));
        if ((abbr1.length >= 2 && titleClean.includes(abbr1)) ||
            (abbr2.length >= 2 && titleClean.includes(abbr2))) {
          isFromSource = true;
          break;
        }
      }

      if (isFromSource) {
        matchedFromSource++;
        console.log(`  场景${idx}: ✅ 来自推荐剧 [${sourceVideos.join("/")}] → "${title.slice(0, 40)}" (搜索: "${searchQuery}")`);
      } else {
        matchedFromOther++;
        console.log(`  场景${idx}: ⚠️ 非推荐剧 [${sourceVideos.join("/")}] → "${title.slice(0, 40)}" (搜索: "${searchQuery}", 来源: ${source})`);
      }
    }

    console.log("\n=== 素材匹配统计 ===");
    console.log(`总场景数: ${totalScenes}`);
    console.log(`来自推荐剧: ${matchedFromSource} (${totalScenes > 0 ? Math.round(matchedFromSource / totalScenes * 100) : 0}%)`);
    console.log(`非推荐剧: ${matchedFromOther} (${totalScenes > 0 ? Math.round(matchedFromOther / totalScenes * 100) : 0}%)`);
    console.log(`无素材: ${noMaterial}`);

    // 核心断言：至少 60% 的场景素材来自推荐剧
    const matchRate = totalScenes > 0 ? matchedFromSource / totalScenes : 0;
    assert(matchRate >= 0.6, `素材匹配率 ${Math.round(matchRate * 100)}% >= 60%`);
    assert(noMaterial === 0, `所有场景都有素材`);

  } finally {
    await prisma.$disconnect();
  }

  console.log("\n=== 测试结果 ===");
  console.log(`通过: ${passCount}, 失败: ${failCount}`);
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("测试异常:", err);
  process.exit(1);
});
