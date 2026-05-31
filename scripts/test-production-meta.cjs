/**
 * 测试 productionMeta 详情
 */
const BASE = "http://localhost:3000";

const TEST_TEXT = `朱棣，从北平藩王到永乐大帝。

十一岁封燕王，二十一岁就藩北平。驻守北疆，直面蒙古残部。据《明史》记载，朱棣早年屡次随大将军出塞作战，威震漠北。

但问题是：皇位跟他没关系。朱元璋立的太子是朱标，朱标死后立的是朱标的儿子朱允炆。朱棣不过是藩王中最能打的那一个。`;

async function main() {
  console.log("═══ 测试 productionMeta 生成 ═══\n");

  // Create project
  const createRes = await fetch(`${BASE}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "朱棣", sourceText: TEST_TEXT,
      aspectRatio: "16:9", voice: "yunxi", contentStyle: "knowledge",
    }),
  });
  
  if (!createRes.ok) {
    console.log("创建失败:", createRes.status, await createRes.text());
    return;
  }
  const project = await createRes.json();
  if (!project.id) {
    console.log("项目数据:", JSON.stringify(project));
    return;
  }
  console.log(`项目: ${project.id}`);

  // Quick generate
  const genRes = await fetch(`${BASE}/api/projects/${project.id}/quick-generate`, { method: "POST" });
  await genRes.json();

  // Get storyboard
  const sbRes = await fetch(`${BASE}/api/projects/${project.id}/storyboard`);
  const sb = await sbRes.json();
  const scenes = sb.scenes || sb.storyboard?.scenes || [];
  
  if (scenes.length === 0) {
    console.log("响应结构:", JSON.stringify(Object.keys(sb)));
    console.log("⚠️ 无场景数据");
    await fetch(`${BASE}/api/projects/${project.id}`, { method: "DELETE" }).catch(() => {});
    return;
  }

  // Show each scene's productionMeta
  for (const scene of scenes) {
    console.log(`\n──────── 场景${scene.sceneNumber}【${scene.title}】────────`);
    console.log(`画面类型: ${scene.sceneType}`);
    console.log(`素材检索: ${scene.materialQuery}`);
    console.log(`画面描述: ${scene.visualDesc}`);
    
    if (scene.productionMeta) {
      const meta = JSON.parse(scene.productionMeta);
      if (meta.scripts?.length) {
        console.log(`口播脚本 (${meta.scripts.length}条):`);
        meta.scripts.forEach((s, i) => console.log(`  ${s}`));
      }
      if (meta.properNouns?.length) {
        console.log(`专名清单: ${meta.properNouns.map(p => `${p.name}(${p.type})`).join("、")}`);
      }
      if (meta.era) console.log(`年代: ${meta.era}`);
      if (meta.sources?.length) console.log(`素材来源: ${meta.sources.join("、")}`);
      if (meta.preference) console.log(`素材偏好: ${meta.preference}`);
    } else {
      console.log("⚠️ 无 productionMeta");
    }
  }

  // Cleanup
  await fetch(`${BASE}/api/projects/${project.id}`, { method: "DELETE" }).catch(() => {});
  console.log("\n✅ 测试完成");
}

main().catch(e => { console.error("❌", e.message); process.exit(1); });
