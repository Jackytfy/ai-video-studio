/**
 * Centralized project state machine.
 *
 * Problem: 9 ProjectStatus values were scattered across 8+ route handlers,
 * pipeline code, and worker scripts. Transitions were enforced ad-hoc,
 * leading to stuck states (e.g. project in ANALYZING after a crash) and
 * inconsistencies (frontend expects PRODUCING/EDITING but backend never
 * writes them).
 *
 * This module defines the single source of truth for all allowed transitions.
 * All status changes MUST go through `transitionProject()`.
 */

import { prisma } from "@/lib/db";

// ── States ──────────────────────────────────────────────────────────

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

// ── Transitions ─────────────────────────────────────────────────────

/**
 * Allowed transitions from each state.
 * Any transition NOT listed here will be rejected.
 */
const TRANSITIONS: Record<ProjectState, ProjectState[]> = {
  DRAFT: ["ANALYZING", "RENDERING", "STORYBOARD_GENERATING"],
  ANALYZING: ["STORYBOARD_GENERATING", "RENDERING", "FAILED", "DRAFT"],
  STORYBOARD_GENERATING: ["STORYBOARD_READY", "RENDERING", "FAILED", "DRAFT"],
  STORYBOARD_READY: ["RENDERING", "STORYBOARD_GENERATING", "ANALYZING"],
  PRODUCING: ["RENDERING", "EDITING", "FAILED"],
  EDITING: ["RENDERING", "FAILED"],
  RENDERING: ["COMPLETED", "FAILED", "DRAFT"],
  COMPLETED: ["RENDERING", "EXPORTING"] as any, // re-render
  FAILED: ["DRAFT", "RENDERING", "STORYBOARD_GENERATING"],
};

// Forward-declare for COMPLETED → RENDERING bypass
(TRANSITIONS.COMPLETED as ProjectState[]).push("RENDERING");

// ── Public API ──────────────────────────────────────────────────────

export interface TransitionResult {
  success: boolean;
  error?: string;
  /** The new state if success, undefined otherwise */
  to?: ProjectState;
  /** The previous state */
  from?: ProjectState;
}

/**
 * Validate whether a transition is allowed without executing it.
 */
export function canTransition(from: ProjectState, to: ProjectState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * Get all allowed transitions from a given state.
 */
export function getAllowedTransitions(from: ProjectState): ProjectState[] {
  return [...(TRANSITIONS[from] ?? [])];
}

/**
 * Atomically transition a project from one state to another.
 *
 * Uses `updateMany` with a condition on the current status to prevent
 * TOCTOU races (two parallel requests both seeing the old status).
 *
 * @returns TransitionResult with success/error details
 */
export async function transitionProject(
  projectId: string,
  userId: string,
  to: ProjectState
): Promise<TransitionResult> {
  // Build the WHERE clause: project must exist, belong to user, and be
  // in a state that allows transitioning TO `to`.
  const allowedFrom = Object.entries(TRANSITIONS)
    .filter(([, targets]) => targets.includes(to))
    .map(([state]) => state);

  if (allowedFrom.length === 0) {
    return { success: false, error: `No source state allows transition to ${to}` };
  }

  const result = await prisma.project.updateMany({
    where: {
      id: projectId,
      userId,
      status: { in: allowedFrom },
    },
    data: { status: to },
  });

  if (result.count === 0) {
    // Could not transition — read current state for a helpful error
    const current = await prisma.project.findUnique({
      where: { id: projectId },
      select: { status: true },
    });

    const from = (current?.status ?? "UNKNOWN") as string;
    return {
      success: false,
      from: from as ProjectState,
      error: `Cannot transition from ${from} to ${to}. Allowed source states: [${allowedFrom.join(", ")}]`,
    };
  }

  return { success: true, to };
}

/**
 * Synchronous check (no DB call) — use for UI validation.
 */
export function isValidTransition(from: string, to: string): boolean {
  if (!ProjectStates.includes(from as ProjectState)) return false;
  if (!ProjectStates.includes(to as ProjectState)) return false;
  return canTransition(from as ProjectState, to as ProjectState);
}

/**
 * Get a human-readable status label for the UI.
 */
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

/**
 * All statuses that indicate the project is "in progress" (should poll / SSE).
 */
export const ACTIVE_STATUSES: ProjectState[] = [
  "ANALYZING",
  "STORYBOARD_GENERATING",
  "RENDERING",
  "PRODUCING",
];

/**
 * All statuses where a cancel/reset is appropriate.
 */
export const CANCELLABLE_STATUSES: ProjectState[] = [
  "ANALYZING",
  "STORYBOARD_GENERATING",
  "RENDERING",
  "FAILED",
];
