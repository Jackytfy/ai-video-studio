import { NextResponse } from "next/server";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { transitionProject, CANCELLABLE_STATUSES } from "@/lib/state-machine";

/**
 * POST /api/projects/[id]/render/cancel
 *
 * Cancels a running render by resetting the project to DRAFT.
 * Uses the centralized state machine for consistent transition validation.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    const { id } = await params;

    const transition = await transitionProject(id, session.user.id, "DRAFT");

    if (!transition.success) {
      return NextResponse.json(
        { error: `当前项目状态(${transition.from})不允许取消` },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, status: "DRAFT" });
  } catch (error) {
    console.error("Cancel render error:", error);
    return NextResponse.json(
      { error: "取消失败: " + (error instanceof Error ? error.message : "未知错误") },
      { status: 500 }
    );
  }
}
