const { PrismaClient } = require("../src/generated/prisma/client");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");
const fs = require("fs");

console.log("dev.db exists:", fs.existsSync("./dev.db"));
console.log("dev.db size:", fs.statSync("./dev.db").size, "bytes");

const adapter = new PrismaBetterSqlite3({ url: "file:./dev.db" });
const prisma = new PrismaClient({ adapter });

(async () => {
  try {
    const user = await prisma.user.findFirst();
    console.log("User:", user?.id || "NONE", user?.email || "NONE", user?.ttsProvider || "NONE", user?.ttsVoice || "NONE");

    const count = await prisma.project.count();
    console.log("Projects:", count);

    const projects = await prisma.project.findMany({ include: { storyboard: { include: { _count: { select: { scenes: true } } } } }, orderBy: { updatedAt: "desc" }, take: 5 });
    for (const p of projects) {
      console.log("  -", p.id, p.status, "scenes:", p.storyboard?._count?.scenes || 0);
    }

    // Check if default user ID has a record
    const defaultUser = await prisma.user.findUnique({ where: { id: "cmp3v2aqa0000k8ulak8r79d5" } });
    console.log("Default user exists:", !!defaultUser);
  } catch (e) {
    console.error("Error:", e.message);
  }
  await prisma.$disconnect();
})();
