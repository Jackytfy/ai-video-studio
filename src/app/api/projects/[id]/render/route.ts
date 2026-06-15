import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { renderProjectInline } from "@/lib/render/pipeline";
import { applyRateLimit, RENDER_LIMIT } from "@/lib/utils/rate-limit";
import { transitionProject } from "@/lib/state-machine";
import { submitRenderTask, getPendingTaskCount } from "@/lib/queue/task-runner";

/**
 * POST /api/projects/[id]/render
 *
 * Submits a render task to the DB-backed queue (async by default).
 * The worker process picks it up and executes the full pipeline.
 *
 * Query param `?sync=true` uses the legacy inline render (for environments
 * where no worker is running).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    // Rate limit: max 10 renders per user per hour
    const limitResponse = applyRateLimit(req, session.user.id, RENDER_LIMIT);
    if (limitResponse) return limitResponse;

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

    // Use the centralized state machine for an atomic, TOCTOU-safe transition.
    const transition = await transitionProject(id, session.user.id, "RENDERING");

    if (!transition.success) {
      const status = transition.from ?? "UNKNOWN";
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

    // Check if caller explicitly wants sync (legacy inline mode)
    const url = new URL(req.url);
    const sync = url.searchParams.get("sync") === "true";

    if (sync) {
      // Legacy inline render — blocks until complete
      const result = await renderProjectInline(id, session.user.id);
      return NextResponse.json({
        mode: "sync",
        success: true,
        outputUrl: result.outputUrl,
        duration: result.duration,
      });
    }

    // Async mode — submit to DB task queue, return immediately.
    // A worker process picks up the task and executes the pipeline.
    const { taskId } = await submitRenderTask(id, session.user.id);
    const pendingCount = await getPendingTaskCount();

    return NextResponse.json({
      mode: "async",
      success: true,
      taskId,
      message: "渲染任务已提交，将通过 SSE 推送进度",
      queueSize: pendingCount,
    });
  } catch (error) {
    console.error("Render error:", error);
    return NextResponse.json(
      { error: "渲染失败: " + (error instanceof Error ? error.message : "未知错误") },
      { status: 500 }
    );
  }
}
