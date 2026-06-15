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
import { ProjectStates, type ProjectState } from "./state-machine-constants";

// Re-export constants for backward compatibility.
// Client components should import from state-machine-constants instead.
export {
  ACTIVE_STATUSES,
  CANCELLABLE_STATUSES,
  getStatusLabel,
} from "./state-machine-constants";
export type { ProjectState } from "./state-machine-constants";

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
  COMPLETED: ["RENDERING"], // re-render
  FAILED: ["DRAFT", "RENDERING", "STORYBOARD_GENERATING"],
};

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
      status: { in: allowedFrom as ProjectState[] },
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
