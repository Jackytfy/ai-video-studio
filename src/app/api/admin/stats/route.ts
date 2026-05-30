import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getServerSession } from "next-auth";

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email! },
    select: { role: true },
  });
  if (user?.role !== "ADMIN") {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const [userCount, projectCount, totalUsers, recentUsers] = await Promise.all([
    prisma.user.count(),
    prisma.project.count(),
    prisma.user.count({ where: { role: "ADMIN" } }),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, name: true, email: true, role: true, createdAt: true, _count: { select: { projects: true } } },
    }),
  ]);

  const statusCounts = await prisma.project.groupBy({
    by: ["status"],
    _count: true,
  });

  return NextResponse.json({
    userCount,
    projectCount,
    adminCount: totalUsers,
    recentUsers,
    projectStatusDistribution: statusCounts.map((s) => ({ status: s.status, count: s._count })),
  });
}
