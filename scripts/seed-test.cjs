const { PrismaClient } = require("../src/generated/prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

const adapter = new PrismaBetterSqlite3({ url: "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

const PROJECT_ID = "cmpsguvax000064ullxjbpgwu";

const texts = [
  "人工智能正在改变我们的世界，从手机助手到自动驾驶。",
  "深度学习让计算机能够从海量数据中学习规律。",
  "未来，AI将成为每个人的智能助手和创新工具。",
];

(async () => {
  const sb = await prisma.storyboard.create({
    data: { projectId: PROJECT_ID, status: "CONFIRMED", totalScenes: 3, totalDuration: 15 },
  });

  for (let i = 0; i < texts.length; i++) {
    await prisma.scene.create({
      data: {
        storyboardId: sb.id,
        sceneNumber: i + 1,
        voiceoverText: texts[i],
        visualDesc: "科技场景",
        duration: 5,
      },
    });
  }

  await prisma.project.update({
    where: { id: PROJECT_ID },
    data: { status: "STORYBOARD_READY" },
  });

  console.log("Seed done:", PROJECT_ID);
  await prisma.$disconnect();
})();
