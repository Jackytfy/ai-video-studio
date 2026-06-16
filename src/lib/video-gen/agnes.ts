/**
 * Agnes Video V2.0 API client.
 *
 * Async task-based API: create task → poll status → download video.
 * Docs: https://agnes-ai.com/doc/agnes-video-v20
 */

import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";

const AGNES_API_BASE = "https://apihub.agnes-ai.com";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 120; // 10 minutes timeout

export interface AgnesVideoOptions {
  height?: number;
  width?: number;
  numFrames?: number; // must be 8n+1, max 441
  frameRate?: number; // 1-60
  model?: string;
}

interface CreateTaskResponse {
  id: string;
  task_id: string;
  video_id: string;
  status: string;
  seconds: string;
  size: string;
}

interface PollResponse {
  id: string;
  video_id: string;
  model: string;
  status: string;
  progress: number;
  seconds: string;
  size: string;
  remixed_from_video_id?: string;
  error?: string | null;
}

function getApiKey(): string {
  const key = process.env.AGNES_API_KEY;
  if (!key) throw new Error("AGNES_API_KEY not configured");
  return key;
}

/**
 * Create a video generation task.
 * Returns taskId and videoId for polling.
 */
export async function createVideoTask(
  prompt: string,
  options?: AgnesVideoOptions
): Promise<{ taskId: string; videoId: string }> {
  const apiKey = getApiKey();
  const model = options?.model ?? "agnes-video-v2.0";
  const width = options?.width ?? 1152;
  const height = options?.height ?? 768;
  const numFrames = options?.numFrames ?? 121;
  const frameRate = options?.frameRate ?? 24;

  const res = await fetch(`${AGNES_API_BASE}/v1/videos`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      prompt,
      width,
      height,
      num_frames: numFrames,
      frame_rate: frameRate,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Agnes create task failed (${res.status}): ${body}`);
  }

  const data: CreateTaskResponse = await res.json();
  return { taskId: data.task_id, videoId: data.video_id };
}

/**
 * Poll video generation status until completed or failed.
 * Calls onProgress with status updates.
 */
export async function pollVideoResult(
  videoId: string,
  onProgress?: (status: string, progress: number) => void
): Promise<{ status: string; videoUrl: string | null; seconds: number }> {
  const apiKey = getApiKey();

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    try {
      const res = await fetch(
        `${AGNES_API_BASE}/agnesapi?video_id=${encodeURIComponent(videoId)}`,
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(15_000),
        }
      );

      if (!res.ok) continue; // retry on transient errors

      const data: PollResponse = await res.json();
      onProgress?.(data.status, data.progress);

      if (data.status === "completed") {
        return {
          status: "completed",
          videoUrl: data.remixed_from_video_id ?? null,
          seconds: parseFloat(data.seconds) || 0,
        };
      }

      if (data.status === "failed" || data.status === "error") {
        return {
          status: "failed",
          videoUrl: null,
          seconds: 0,
        };
      }
    } catch {
      // Network error — continue polling
    }
  }

  return { status: "timeout", videoUrl: null, seconds: 0 };
}

/**
 * Download a video from URL to local path.
 */
export async function downloadVideo(
  videoUrl: string,
  outputPath: string
): Promise<void> {
  const res = await fetch(videoUrl, {
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    throw new Error(`Download failed (${res.status}): ${videoUrl}`);
  }

  if (!res.body) {
    throw new Error("Download response has no body");
  }

  const nodeStream = Readable.fromWeb(res.body as any);
  await pipeline(nodeStream, createWriteStream(outputPath));
}
