"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { MessageSquare, Layers, Film, ArrowRight, Loader2, CheckCircle, AlertCircle, Play, RefreshCw } from "lucide-react";

const POLLING_STATUSES = ["RENDERING"];

const statusMap: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "草稿", color: "text-muted-foreground" },
  ANALYZING: { label: "分析中", color: "text-yellow-400" },
  STORYBOARD_GENERATING: { label: "生成分镜中", color: "text-yellow-400" },
  STORYBOARD_READY: { label: "分镜就绪", color: "text-blue-400" },
  PRODUCING: { label: "制作中", color: "text-cyan-400" },
  EDITING: { label: "编辑中", color: "text-purple" },
  RENDERING: { label: "渲染中", color: "text-orange-400" },
  COMPLETED: { label: "已完成", color: "text-green-400" },
  FAILED: { label: "失败", color: "text-destructive" },
};

export default function ProjectDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const projectId = params.id as string;

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

  const { data: project, isLoading } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("获取项目失败");
      return res.json();
    },
    refetchInterval: (query) => {
      const state = query.state.data as { status?: string } | undefined;
      if (!state || !POLLING_STATUSES.includes(state.status ?? "")) return false;
      const elapsed = Date.now() - (query.state.dataUpdatedAt || Date.now());
      if (elapsed > 120_000) return false;
      return 5000;
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
        </div>
        <p className="text-muted-foreground text-sm">
          {project.aspectRatio.replace("W_", "").replace("_", ":")} ·{" "}
          {project.contentStyle} ·{" "}
          {new Date(project.createdAt).toLocaleDateString("zh-CN")}
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6">
        <h2 className="font-semibold mb-3">源文稿</h2>
        <p className="text-sm text-muted-foreground whitespace-pre-wrap line-clamp-6">
          {project.sourceText}
        </p>
      </div>

      {/* Video Player */}
      {project.status === "COMPLETED" && project.renderJobs?.[0]?.outputUrl && (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <div className="px-6 py-3 border-b border-border">
            <h2 className="font-semibold">生成的视频</h2>
          </div>
          <div className="p-4">
            <video
              src={project.renderJobs[0].outputUrl}
              controls
              className="w-full rounded-lg bg-black"
            />
            {project.renderJobs[0].outputDuration && (
              <p className="text-xs text-muted-foreground mt-2">
                时长: {Math.round(project.renderJobs[0].outputDuration)}秒 ·
                大小: {project.renderJobs[0].outputSize ? `${(project.renderJobs[0].outputSize / 1024 / 1024).toFixed(1)}MB` : "未知"}
              </p>
            )}
          </div>
        </div>
      )}

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
                TTS配音 · 素材合成 · 视频生成
              </p>
            </div>
          </div>
        ) : project.status === "COMPLETED" ? (
          <div className="bg-card border border-green-400/30 rounded-xl p-5 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-400" />
            <div>
              <p className="font-medium text-sm">渲染完成</p>
              <p className="text-xs text-muted-foreground">查看下方视频</p>
            </div>
          </div>
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
    </div>
  );
}
