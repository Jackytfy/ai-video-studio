"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { MessageSquare, Layers, Film, ArrowRight, Loader2, CheckCircle, AlertCircle, Play, RefreshCw, Download, Trash2 } from "lucide-react";
import { ACTIVE_STATUSES, ProjectStates, getStatusLabel } from "@/lib/state-machine";

// Polling statuses: both project-level and renderJob-level active states
const POLLING_STATUSES = [...ACTIVE_STATUSES, "COMPOSITING", "TTS_GENERATING", "MATERIALS_LOADING"];

const statusColors: Record<string, string> = {
  DRAFT: "text-muted-foreground",
  ANALYZING: "text-yellow-400",
  STORYBOARD_GENERATING: "text-yellow-400",
  STORYBOARD_READY: "text-blue-400",
  PRODUCING: "text-cyan-400",
  EDITING: "text-purple",
  RENDERING: "text-orange-400",
  COMPLETED: "text-green-400",
  FAILED: "text-destructive",
};

const statusMap: Record<string, { label: string; color: string }> = Object.fromEntries(
  ProjectStates.map((s) => [s, { label: getStatusLabel(s), color: statusColors[s] || "text-muted-foreground" }])
);

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const projectId = params.id as string;

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const renderMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/render`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "渲染失败");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      router.push("/dashboard");
    },
  });

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("获取项目失败");
      return res.json();
    },
    refetchInterval: (query) => {
      const state = query.state.data as { status?: string; renderJobs?: Array<{ status: string }> } | undefined;
      if (!state) return false;
      // Poll during rendering and also when renderJobs has an active job.
      // Prefer SSE (useProjectEvents) for lower-latency updates; this poll
      // acts as a safety-net fallback at a relaxed 5 s interval to reduce
      // SQLite write-lock contention during concurrent renders.
      const isRendering = POLLING_STATUSES.includes(state.status ?? "");
      const hasActiveRender = state.renderJobs?.[0]?.status && !["COMPLETED", "FAILED"].includes(state.renderJobs[0].status);
      if (!isRendering && !hasActiveRender) return false;
      const elapsed = Date.now() - (query.state.dataUpdatedAt || Date.now());
      if (elapsed > 600_000) return false; // 10 min timeout
      return 5000; // Poll every 5 seconds (reduced from 3s to ease DB load)
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <div className="h-8 bg-secondary rounded w-1/3" />
        <div className="h-32 bg-secondary rounded" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="p-6 text-center">
        <p className="text-muted-foreground">项目不存在</p>
      </div>
    );
  }

  const status = statusMap[project.status] || statusMap.DRAFT;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <span className={`text-sm font-medium ${status.color}`}>
            {status.label}
          </span>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="ml-auto p-2 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            title="删除项目"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
        <p className="text-muted-foreground text-sm">
          {project.aspectRatio.replace("W_", "").replace("_", ":")} ·{" "}
          {project.contentStyle} ·{" "}
          {new Date(project.createdAt).toLocaleDateString("zh-CN")}
        </p>
      </div>

      {/* Video Player - Show prominently at top when completed */}
      {project.status === "COMPLETED" && project.renderJobs?.[0]?.outputUrl && (
        <div className="bg-card border-2 border-green-400/40 rounded-xl overflow-hidden shadow-lg shadow-green-400/5">
          <div className="px-6 py-4 border-b border-border bg-green-400/5 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-400" />
              <h2 className="font-semibold text-lg">视频已生成</h2>
            </div>
            <div className="flex items-center gap-3 text-sm text-muted-foreground">
              {project.renderJobs[0].outputDuration && (
                <span>{Math.round(project.renderJobs[0].outputDuration)}秒</span>
              )}
              {project.renderJobs[0].outputSize && (
                <span>{(project.renderJobs[0].outputSize / 1024 / 1024).toFixed(1)} MB</span>
              )}
              <a
                href={project.renderJobs[0].outputUrl}
                download
                className="flex items-center gap-1 text-purple hover:text-purple-light transition-colors"
              >
                <Download className="w-4 h-4" />
                下载
              </a>
            </div>
          </div>
          <div className="bg-black">
            <video
              src={project.renderJobs[0].outputUrl}
              controls
              playsInline
              preload="metadata"
              className="w-full max-h-[70vh] object-contain"
            />
          </div>
        </div>
      )}

      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="font-semibold mb-3">源文稿</h2>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-6">
          {project.sourceText}
        </p>
      </div>

      {project.aiAnalysis && (() => {
        const analysis = typeof project.aiAnalysis === "string"
          ? JSON.parse(project.aiAnalysis)
          : project.aiAnalysis;
        return (
          <div className="bg-card border border-border rounded-xl p-6">
            <h2 className="font-semibold mb-3">AI 分析结果</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">摘要：</span>
                <span>{analysis.summary}</span>
              </div>
              <div>
                <span className="text-muted-foreground">场景数：</span>
                <span>{analysis.sceneCount}</span>
              </div>
              <div>
                <span className="text-muted-foreground">预估时长：</span>
                <span>{analysis.estimatedDuration}秒</span>
              </div>
              <div>
                <span className="text-muted-foreground">推荐方案：</span>
                <span>方案{analysis.suggestedPlan}</span>
              </div>
            </div>
          </div>
        );
      })()}

      {project.storyboard && (
        <div className="bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">分镜脚本</h2>
            <Link
              href={`/projects/${projectId}/storyboard`}
              className="text-purple text-sm flex items-center gap-1 hover:text-purple-light"
            >
              查看分镜 <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="flex gap-6 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              <Layers className="w-3 h-3" />
              {project.storyboard.totalScenes} 个场景
            </span>
            {project.storyboard.totalDuration && (
              <span>
                约 {Math.round(project.storyboard.totalDuration)} 秒
              </span>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4">
        <Link
          href={`/projects/${projectId}/chat`}
          className="bg-card border border-border rounded-xl p-5 hover:border-purple/30 transition-all flex items-center gap-3"
        >
          <MessageSquare className="w-5 h-5 text-purple" />
          <div>
            <p className="font-medium text-sm">AI 对话</p>
            <p className="text-xs text-muted-foreground">
              {project._count.messages} 条消息
            </p>
          </div>
        </Link>

        <Link
          href={`/projects/${projectId}/storyboard`}
          className="bg-card border border-border rounded-xl p-5 hover:border-purple/30 transition-all flex items-center gap-3"
        >
          <Layers className="w-5 h-5 text-purple" />
          <div>
            <p className="font-medium text-sm">分镜编辑</p>
            <p className="text-xs text-muted-foreground">
              {project.storyboard?.totalScenes || 0} 个场景
            </p>
          </div>
        </Link>

        {project.status === "RENDERING" ? (
          <div className="bg-card border border-orange-400/30 rounded-xl p-5 flex items-center gap-3">
            <Loader2 className="w-5 h-5 text-orange-400 animate-spin" />
            <div>
              <p className="font-medium text-sm">渲染中</p>
              <p className="text-xs text-muted-foreground">
                {project.renderJobs?.[0]?.currentStage === "tts" ? "TTS配音生成中..."
                : project.renderJobs?.[0]?.currentStage === "materials" ? "素材下载中..."
                : project.renderJobs?.[0]?.currentStage === "compose" ? "视频合成中..."
                : "TTS配音 · 素材合成 · 视频生成"}
              </p>
            </div>
          </div>
        ) : project.status === "COMPLETED" ? (
          <button
            onClick={() => document.querySelector("video")?.scrollIntoView({ behavior: "smooth" })}
            className="bg-card border border-green-400/30 rounded-xl p-5 hover:border-green-400/60 transition-all flex items-center gap-3"
          >
            <Play className="w-5 h-5 text-green-400" />
            <div>
              <p className="font-medium text-sm">预览视频</p>
              <p className="text-xs text-muted-foreground">点击跳转到视频</p>
            </div>
          </button>
        ) : project.status === "FAILED" ? (
          <button
            onClick={() => renderMutation.mutate()}
            disabled={renderMutation.isPending}
            className="bg-card border border-destructive/30 rounded-xl p-5 hover:border-purple/30 transition-all flex items-center gap-3"
          >
            {renderMutation.isPending ? (
              <Loader2 className="w-5 h-5 text-purple animate-spin" />
            ) : (
              <RefreshCw className="w-5 h-5 text-destructive" />
            )}
            <div>
              <p className="font-medium text-sm">
                {renderMutation.isPending ? "重新渲染中..." : "重新渲染"}
              </p>
              <p className="text-xs text-muted-foreground">点击重试</p>
            </div>
          </button>
        ) : (
          <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-3 opacity-50">
            <Film className="w-5 h-5 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">视频渲染</p>
              <p className="text-xs text-muted-foreground">
                需先确认分镜
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-card border border-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl animate-in">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 rounded-full bg-destructive/10">
                <Trash2 className="w-5 h-5 text-destructive" />
              </div>
              <h3 className="font-semibold text-lg">删除项目</h3>
            </div>
            <p className="text-sm text-muted-foreground mb-2">
              确定要删除 <span className="font-medium text-foreground">「{project.name}」</span> 吗？
            </p>
            <p className="text-xs text-muted-foreground mb-6">
              此操作将同时删除所有关联的视频文件、配音、分镜和聊天记录，无法恢复。
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-secondary transition-colors disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="px-4 py-2 text-sm rounded-lg bg-destructive text-white hover:bg-destructive/90 transition-colors flex items-center gap-2 disabled:opacity-50"
              >
                {deleteMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    删除中...
                  </>
                ) : (
                  "确认删除"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
