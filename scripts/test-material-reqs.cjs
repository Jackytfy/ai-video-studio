/**
 * Test script for material requirements optimization
 * Tests the full flow: create project with materialRequirements → quick-generate → verify
 */
const BASE = "http://localhost:3000";

async function main() {
  console.log("=== 测试花生需求优化 ===\n");

  // Step 1: Create project with materialRequirements
  console.log("Step 1: 创建项目（含素材需求）...");
  const createRes = await fetch(`${BASE}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "测试花生需求-大明风骨",
      sourceText: `从清宫剧的衰落与明史剧的复兴现象切入，深度剖析年轻人审美转向背后的文化心理。通过对比明清两朝的政治生态、官员风骨、文化政策等细节，揭示"大明风骨"为何成为当代年轻人的精神共鸣——不是怀念某个朝代，而是向往一种"站着活"的人格尊严。`,
      contentStyle: "classic",
      materialRequirements: {
        contentSummary: "从清宫剧衰落与明史剧复兴现象切入，深度剖析年轻人审美转向",
        referenceStyle: "B站历史区UP主解说风格，节奏紧凑、观点鲜明、史料扎实",
        requiredSources: ["甄嬛传", "大明王朝1566"],
        preferredSources: ["康熙王朝", "中国通史", "如懿传"],
        materialTypes: ["影视剧片段", "历史纪录片", "古籍影像", "古代绘画"],
        properNouns: ["朱元璋", "朱棣", "嘉靖", "海瑞", "乾隆", "故宫"],
        landmarkScenes: ["紫禁城太和殿", "古代朝堂", "科举考场"],
        stylePreference: "历史厚重感，色调偏沉稳，人物特写，情绪冲突强烈",
        regionLimit: "中国古代场景，避免现代城市景观混入",
        avoidKeywords: ["现代城市", "综艺", "游戏"],
      },
    }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    console.error("创建项目失败:", createRes.status, err);
    return;
  }
  const project = await createRes.json();
  console.log(`项目创建成功! ID: ${project.id}`);
  console.log(`  materialRequirements 已存储: ${project.materialRequirements ? "YES" : "NO"}`);

  // Verify materialRequirements was stored correctly
  if (project.materialRequirements) {
    const reqs = JSON.parse(project.materialRequirements);
    console.log(`  requiredSources: ${reqs.requiredSources?.join(", ") || "MISSING"}`);
    console.log(`  preferredSources: ${reqs.preferredSources?.join(", ") || "MISSING"}`);
    console.log(`  properNouns: ${reqs.properNouns?.join(", ") || "MISSING"}`);
    console.log(`  landmarkScenes: ${reqs.landmarkScenes?.join(", ") || "MISSING"}`);
    console.log(`  contentSummary: ${reqs.contentSummary ? "YES" : "MISSING"}`);
    console.log(`  referenceStyle: ${reqs.referenceStyle ? "YES" : "MISSING"}`);
    console.log(`  regionLimit: ${reqs.regionLimit ? "YES" : "MISSING"}`);
    console.log(`  avoidKeywords: ${reqs.avoidKeywords?.join(", ") || "MISSING"}`);
  } else {
    console.error("  materialRequirements 未存储!");
  }

  // Step 2: Quick-generate storyboard
  console.log("\nStep 2: 生成分镜（含素材需求注入）...");
  const sbRes = await fetch(`${BASE}/api/projects/${project.id}/quick-generate`, {
    method: "POST",
  });

  if (!sbRes.ok) {
    const err = await sbRes.text();
    console.error("分镜生成失败:", sbRes.status, err);
    return;
  }
  const sbData = await sbRes.json();
  console.log(`分镜生成成功! 共 ${sbData.storyboard?.totalScenes || 0} 个场景`);

  // Step 3: Verify scenes have sourceVideos referencing required sources
  if (sbData.storyboard?.scenes) {
    const scenes = sbData.storyboard.scenes;
    console.log("\nStep 3: 验证场景素材来源...");

    let totalSourceVideos = 0;
    let requiredSourceHits = 0;
    const requiredSources = ["甄嬛传", "大明王朝1566"];
    const properNouns = ["朱元璋", "朱棣", "嘉靖", "海瑞", "乾隆", "故宫"];

    for (const scene of scenes) {
      let meta = null;
      if (scene.productionMeta) {
        try { meta = JSON.parse(scene.productionMeta); } catch {}
      }
      const svs = meta?.sourceVideos || [];
      totalSourceVideos += svs.length;

      // Check if required sources are referenced
      for (const rs of requiredSources) {
        if (svs.some(sv => sv.includes(rs))) {
          requiredSourceHits++;
        }
      }

      // Check if properNouns appear in voiceoverText
      const voiceText = scene.voiceoverText || "";
      const matchedNouns = properNouns.filter(pn => voiceText.includes(pn));

      if (svs.length > 0 || matchedNouns.length > 0) {
        console.log(`  场景${scene.sceneNumber}: sourceVideos=[${svs.join(",")}] 专名匹配=[${matchedNouns.join(",")}]`);
      }
    }

    console.log(`\n素材来源统计:`);
    console.log(`  总sourceVideos引用: ${totalSourceVideos}`);
    console.log(`  必须来源命中次数: ${requiredSourceHits} / ${requiredSources.length * scenes.length} 可能`);
    console.log(`  必须来源覆盖: ${requiredSources.map(rs => scenes.some(s => {
      try { const m = JSON.parse(s.productionMeta); return m?.sourceVideos?.some(sv => sv.includes(rs)); } catch { return false; }
    }) ? rs + " ✅" : rs + " ❌").join(", ")}`);

    // Check properNouns coverage
    const allVoiceText = scenes.map(s => s.voiceoverText || "").join("");
    const nounCoverage = properNouns.map(pn => allVoiceText.includes(pn) ? `${pn} ✅` : `${pn} ❌`);
    console.log(`  专名覆盖: ${nounCoverage.join(", ")}`);
  }

  console.log("\n=== 测试完成 ===");
}

main().catch(console.error);
