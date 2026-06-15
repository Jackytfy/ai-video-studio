import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { renderProjectInline } from "@/lib/render/pipeline";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    const { id } = await params;
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
      include: { storyboard: true },
    });

    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    if (!project.storyboard || project.storyboard.status !== "CONFIRMED") {
      return NextResponse.json(
        { error: "请先确认分镜脚本" },
        { status: 400 }
      );
    }

    // Atomic claim: only one request can transition a project into RENDERING.
    // The previous read-then-write check had a TOCTOU race: two parallel
    // requests could both observe status != RENDERING and both kick off a
    // render, producing duplicate RenderJob rows and corrupted output files.
    //
    // `updateMany` returns `{ count }` — if 0, someone else won the race.
    const claim = await prisma.project.updateMany({
      where: {
        id,
        // Only allow the transition from these source states. RENDERING is
        // intentionally excluded so a second concurrent request is rejected.
        status: { in: ["STORYBOARD_READY", "COMPLETED", "FAILED", "DRAFT"] },
      },
      data: { status: "RENDERING" },
    });

    if (claim.count === 0) {
      // The project is either already rendering, or in a state we don't
      // accept transitions from. Re-read to give a precise error.
      const fresh = await prisma.project.findUnique({
        where: { id },
        select: { status: true },
      });
      const status = fresh?.status ?? "UNKNOWN";
      if (status === "RENDERING") {
        return NextResponse.json(
          { error: "项目正在渲染中，请稍候" },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: `当前项目状态(${status})不允许渲染` },
        { status: 409 }
      );
    }

    // Inline render - no Redis needed. If this throws, the project will be
    // stuck in RENDERING — pipeline.ts sets FAILED itself, but if it crashes
    // before that, a future request will be rejected by the gate above. The
    // caller can then use the "reset failed project" admin action.
    const result = await renderProjectInline(id, session.user.id);

    return NextResponse.json({
      success: true,
      outputUrl: result.outputUrl,
      duration: result.duration,
    });
  } catch (error) {
    console.error("Render error:", error);
    return NextResponse.json(
      { error: "渲染失败: " + (error instanceof Error ? error.message : "未知错误") },
      { status: 500 }
    );
  }
}
