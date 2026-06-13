"use client";

import { Loader2, CheckCircle, XCircle, Mic, Film } from "lucide-react";
import { useProjectEvents, type SceneProgress } from "@/hooks/useProjectEvents";

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

interface RenderProgressPanelProps {
  projectId: string;
}

export function RenderProgressPanel({ projectId }: RenderProgressPanelProps) {
  const { renderJob, sceneProgress, isConnected } = useProjectEvents(projectId);

  if (!renderJob && sceneProgress.ttsTotal === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        暂无渲染任务
      </div>
    );
  }

  const isComplete = renderJob?.status === "COMPLETED";
  const isFailed = renderJob?.status === "FAILED";
  const isActive = renderJob && !isComplete && !isFailed;

  return (
    <div className="space-y-4">
      {/* Scene-level progress */}
      {sceneProgress.ttsTotal > 0 && (
        <div className="bg-card border border-border rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">场景进度</span>
            <span className="text-xs text-muted-foreground">
              {isConnected ? "实时" : "离线"}
            </span>
          </div>

          {/* TTS progress */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <Mic className="w-3 h-3 text-purple" />
                配音生成
              </span>
              <span className="text-muted-foreground">
                {sceneProgress.ttsDone}/{sceneProgress.ttsTotal}
              </span>
            </div>
            <div className="w-full bg-secondary rounded-full h-1.5">
              <div
                className="bg-purple h-1.5 rounded-full transition-all duration-500"
                style={{
                  width: `${sceneProgress.ttsTotal > 0 ? (sceneProgress.ttsDone / sceneProgress.ttsTotal) * 100 : 0}%`,
                }}
              />
            </div>
          </div>

          {/* Render progress */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="flex items-center gap-1.5">
                <Film className="w-3 h-3 text-purple" />
                视频生成
              </span>
              <span className="text-muted-foreground">
                {sceneProgress.renderDone}/{sceneProgress.renderTotal}
              </span>
            </div>
            <div className="w-full bg-secondary rounded-full h-1.5">
              <div
                className="bg-purple h-1.5 rounded-full transition-all duration-500"
                style={{
                  width: `${sceneProgress.renderTotal > 0 ? (sceneProgress.renderDone / sceneProgress.renderTotal) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Render job status */}
      {renderJob && (
        <div className="bg-card border border-border rounded-xl p-4">
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
                {stageLabels[renderJob.status] || renderJob.status}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {Math.round(renderJob.progress * 100)}%
            </span>
          </div>

          {isActive && (
            <div className="w-full bg-secondary rounded-full h-2">
              <div
                className="bg-purple h-2 rounded-full transition-all duration-500"
                style={{ width: `${renderJob.progress * 100}%` }}
              />
            </div>
          )}

          {renderJob.currentStage && (
            <p className="text-xs text-muted-foreground mt-2">
              当前阶段：{stageLabels[renderJob.currentStage] || renderJob.currentStage}
            </p>
          )}

          {isFailed && renderJob.errorMessage && (
            <p className="text-xs text-destructive mt-2">
              {renderJob.errorMessage}
            </p>
          )}

          {isComplete && renderJob.outputUrl && (
            <a
              href={renderJob.outputUrl}
              download
              className="inline-block mt-2 text-xs text-purple hover:text-purple-light"
            >
              下载视频
            </a>
          )}
        </div>
      )}
    </div>
  );
}
