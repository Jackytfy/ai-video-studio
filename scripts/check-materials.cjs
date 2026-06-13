const { PrismaClient } = require("../node_modules/.prisma/client");
const p = new PrismaClient();

async function main() {
  const projectId = process.argv[2] || "cmqcacc4q001nw4ul4vi5twaj";

  const materials = await p.material.findMany({
    where: { projectId },
    select: { name: true, searchQuery: true, externalSource: true, externalId: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n=== Materials for project ${projectId} (${materials.length} total) ===\n`);
  for (const m of materials) {
    console.log(`[${m.externalSource}] ${m.externalId}`);
    console.log(`  query: ${m.searchQuery}`);
    console.log(`  name:  ${(m.name || "").substring(0, 60)}`);
    console.log();
  }

  const scenes = await p.scene.findMany({
    where: { storyboard: { projectId } },
    select: { sceneNumber: true, title: true, visualDesc: true, materialQuery: true, productionMeta: true },
    orderBy: { sceneNumber: "asc" },
  });

  console.log(`\n=== Scenes for project ${projectId} (${scenes.length} total) ===\n`);
  for (const s of scenes) {
    console.log(`Scene ${s.sceneNumber}: ${s.title}`);
    console.log(`  visualDesc: ${(s.visualDesc || "").substring(0, 80)}`);
    console.log(`  materialQuery: ${s.materialQuery}`);
    let meta = null;
    try { meta = JSON.parse(s.productionMeta); } catch {}
    if (meta) {
      console.log(`  sourceVideos: ${JSON.stringify(meta.sourceVideos)}`);
      console.log(`  meta.materialQuery: ${meta.materialQuery}`);
    }
    console.log();
  }

  await p.$disconnect();
}

main();
