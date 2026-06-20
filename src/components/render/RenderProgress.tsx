"use client";

import { Loader2, CheckCircle, XCircle, Clock, Film } from "lucide-react";

const stageLabels: Record<string, string> = {
  QUEUED: "排队中",
  PREPARING: "准备中",
  TTS_GENERATING: "生成配音",
  MATERIALS_LOADING: "加载素材",
  COMPOSITING: "合成视频",
  SUBTITLING: "添加字幕",
  POST_PROCESSING: "后期处理",
  COMPLETED: "完成",
  FAILED: "失败",
};

// Scene stage labels for more granular progress
const sceneStageLabels: Record<string, string> = {
  tts: "生成配音",
  ai_generation: "AI 视频生成中...",
  materials: "搜索素材",
  compose: "合成场景",
  downloading: "下载素材",
};

interface RenderJob {
  id: string;
  status: string;
  progress: number;
  currentStage: string | null;
  errorMessage: string | null;
  outputUrl: string | null;
  stageProgress?: string | null; // JSON string with scene-level details
  estimatedDuration?: number | null; // Estimated seconds remaining
  createdAt: string;
}

interface RenderProgressProps {
  jobs: RenderJob[];
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分${Math.round(seconds % 60)}秒`;
  return `${Math.floor(seconds / 3600)}时${Math.floor((seconds % 3600) / 60)}分`;
}

export function RenderProgress({ jobs }: RenderProgressProps) {
  if (jobs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        暂无渲染任务
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {jobs.map((job) => {
        const isComplete = job.status === "COMPLETED";
        const isFailed = job.status === "FAILED";
        const isActive = !isComplete && !isFailed;

        // Parse scene-level progress
        let sceneProgress: {
          sceneIndex?: number;
          totalScenes?: number;
          stage?: string;
          status?: string;
        } | null = null;
        try {
          if (job.stageProgress) {
            sceneProgress = JSON.parse(job.stageProgress);
          }
        } catch {
          // Ignore parse errors
        }

        return (
          <div
            key={job.id}
            className="bg-card border border-border rounded-xl p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                {isActive && (
                  <Loader2 className="w-4 h-4 text-purple animate-spin" />
                )}
                {isComplete && (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                )}
                {isFailed && (
                  <XCircle className="w-4 h-4 text-destructive" />
                )}
                <span className="text-sm font-medium">
                  {stageLabels[job.status] || job.status}
                </span>
              </div>
              <span className="text-xs text-muted-foreground">
                {Math.round(job.progress * 100)}%
              </span>
            </div>

            {isActive && (
              <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                {/* Show indeterminate animation for AI generation (30% stuck) */}
                {sceneProgress?.stage === "ai_generation" && sceneProgress?.status?.includes("30%") ? (
                  <div className="h-2 rounded-full bg-gradient-to-r from-purple/50 via-purple to-purple/50 animate-pulse w-full" />
                ) : (
                  <div
                    className="bg-purple h-2 rounded-full transition-all duration-500"
                    style={{ width: `${job.progress * 100}%` }}
                  />
                )}
              </div>
            )}

            {/* Scene-level progress details */}
            {isActive && sceneProgress && (
              <div className="mt-3 space-y-2 bg-background/50 rounded-lg p-3">
                {/* Scene indicator */}
                {(sceneProgress.sceneIndex !== undefined && sceneProgress.totalScenes) && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Film className="w-3 h-3" />
                    <span>
                      场景 {sceneProgress.sceneIndex + 1} / {sceneProgress.totalScenes}
                    </span>
                  </div>
                )}

                {/* Stage-specific status */}
                {sceneProgress.stage && (
                  <div className="text-xs text-purple-light font-medium">
                    {sceneStageLabels[sceneProgress.stage] || sceneProgress.stage}
                    {sceneProgress.status && ` (${sceneProgress.status})`}
                  </div>
                )}

                {/* AI generation special message with animated indicator */}
                {sceneProgress.stage === "ai_generation" && (
                  <div className="space-y-1">
                    <p className="text-xs text-yellow-500/80 flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      AI 正在生成视频画面...
                    </p>
                    <p className="text-xs text-muted-foreground">
                      ⏱️ 通常需要 3-5 分钟/场景，当前状态正常
                    </p>
                    {/* Progress stages explanation */}
                    <div className="text-[10px] text-muted-foreground/70 mt-1 border-t pt-1">
                      <div>30% → 生成中（最耗时）</div>
                      <div>80% → 即将完成</div>
                      <div>100% → 开始下载</div>
                    </div>
                  </div>
                )}

                {/* Estimated time remaining */}
                {job.estimatedDuration && job.estimatedDuration > 0 && sceneProgress?.stage !== "ai_generation" && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span>预计剩余：{formatTime(job.estimatedDuration)}</span>
                  </div>
                )}
              </div>
            )}

            {job.currentStage && !sceneProgress?.stage && (
              <p className="text-xs text-muted-foreground mt-2">
                当前阶段：{stageLabels[job.currentStage] || job.currentStage}
              </p>
            )}

            {isFailed && job.errorMessage && (
              <p className="text-xs text-destructive mt-2">
                {job.errorMessage}
              </p>
            )}

            {isComplete && job.outputUrl && (
              <a
                href={job.outputUrl}
                download
                className="inline-block mt-2 text-xs text-purple hover:text-purple-light"
              >
                下载视频
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
