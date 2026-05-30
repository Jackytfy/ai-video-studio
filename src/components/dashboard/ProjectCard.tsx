"use client";

import { useState } from "react";
import Link from "next/link";
import { Film, Clock, Layers, Play, CheckCircle, Trash2, Loader2 } from "lucide-react";

const statusMap: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "草稿", color: "text-muted-foreground" },
  ANALYZING: { label: "分析中", color: "text-yellow-400" },
  STORYBOARD_GENERATING: { label: "生成分镜", color: "text-yellow-400" },
  STORYBOARD_READY: { label: "分镜就绪", color: "text-blue-400" },
  PRODUCING: { label: "制作中", color: "text-cyan-400" },
  EDITING: { label: "编辑中", color: "text-purple" },
  RENDERING: { label: "渲染中", color: "text-orange-400" },
  COMPLETED: { label: "已完成", color: "text-green-400" },
  FAILED: { label: "失败", color: "text-destructive" },
};

interface ProjectCardProps {
  project: {
    id: string;
    name: string;
    status: string;
    aspectRatio: string;
    contentStyle: string;
    createdAt: string;
    updatedAt: string;
    storyboard?: {
      totalScenes: number;
      totalDuration: number | null;
      status: string;
    } | null;
  };
  onDelete?: (id: string) => void;
}

export function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const status = statusMap[project.status] || statusMap.DRAFT;
  const timeAgo = getTimeAgo(project.updatedAt);
  const isCompleted = project.status === "COMPLETED";
  const [deleting, setDeleting] = useState(false);
  const href = isCompleted ? `/projects/${project.id}` : `/projects/${project.id}/chat`;

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`确定删除「${project.name}」吗？\n此操作不可撤销，将同时删除所有视频文件。`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      onDelete?.(project.id);
    } catch {
      alert("删除失败，请重试");
      setDeleting(false);
    }
  };

  return (
    <div className="relative group/card">
      <Link
        href={href}
        className={`block border rounded-xl p-5 transition-all hover:shadow-lg ${
          isCompleted
            ? "bg-card border-green-400/30 hover:border-green-400/60 hover:shadow-green-400/10"
            : "bg-card border-border hover:border-purple/30 hover:shadow-purple/5"
        }`}
      >
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            {isCompleted ? (
              <CheckCircle className="w-4 h-4 text-green-400" />
            ) : (
              <Film className="w-4 h-4 text-purple" />
            )}
            <span className={`text-xs font-medium ${status.color}`}>
              {status.label}
            </span>
          </div>
          <span className="text-xs text-muted-foreground">
            {project.aspectRatio.replace("W_", "").replace("_", ":")}
          </span>
        </div>

        <h3 className="font-medium text-sm mb-3 line-clamp-2 group-hover/card:text-purple transition-colors">
          {project.name}
        </h3>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <div className="flex items-center gap-3">
            {project.storyboard && (
              <span className="flex items-center gap-1">
                <Layers className="w-3 h-3" />
                {project.storyboard.totalScenes} 场景
              </span>
            )}
            {isCompleted && (
              <span className="flex items-center gap-1 text-green-400">
                <Play className="w-3 h-3" />
                查看视频
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {timeAgo}
            </span>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-40 group-hover/card:opacity-100"
              title="删除项目"
            >
              {deleting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Trash2 className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>
      </Link>
    </div>
  );
}

function getTimeAgo(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  if (hours < 24) return `${hours} 小时前`;
  return `${days} 天前`;
}
