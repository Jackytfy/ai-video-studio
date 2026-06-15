/**
 * Lightweight state-machine constants — no DB imports.
 * Safe to import from Client Components ("use client").
 *
 * Heavy logic (transitionProject, prisma queries) lives in state-machine.ts.
 */

export const ProjectStates = [
  "DRAFT",
  "ANALYZING",
  "STORYBOARD_GENERATING",
  "STORYBOARD_READY",
  "PRODUCING",
  "EDITING",
  "RENDERING",
  "COMPLETED",
  "FAILED",
] as const;

export type ProjectState = (typeof ProjectStates)[number];

/** Statuses where a render or processing is actively running */
export const ACTIVE_STATUSES: ProjectState[] = [
  "ANALYZING",
  "STORYBOARD_GENERATING",
  "RENDERING",
  "PRODUCING",
];

/** Statuses where a cancel is appropriate */
export const CANCELLABLE_STATUSES: ProjectState[] = [
  "ANALYZING",
  "STORYBOARD_GENERATING",
  "RENDERING",
  "FAILED",
];

/** Human-readable labels */
export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    DRAFT: "草稿",
    ANALYZING: "分析中",
    STORYBOARD_GENERATING: "生成分镜中",
    STORYBOARD_READY: "分镜就绪",
    PRODUCING: "制作中",
    EDITING: "编辑中",
    RENDERING: "渲染中",
    COMPLETED: "已完成",
    FAILED: "失败",
  };
  return labels[status] ?? status;
}
