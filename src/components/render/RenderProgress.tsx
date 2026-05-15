"use client";

import { Loader2, CheckCircle, XCircle } from "lucide-react";

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

interface RenderJob {
  id: string;
  status: string;
  progress: number;
  currentStage: string | null;
  errorMessage: string | null;
  outputUrl: string | null;
  createdAt: string;
}

interface RenderProgressProps {
  jobs: RenderJob[];
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
              <div className="w-full bg-secondary rounded-full h-2">
                <div
                  className="bg-purple h-2 rounded-full transition-all duration-500"
                  style={{ width: `${job.progress * 100}%` }}
                />
              </div>
            )}

            {job.currentStage && (
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
