"use client";

import Link from "next/link";
import { Film, Clock, Layers } from "lucide-react";

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
}

export function ProjectCard({ project }: ProjectCardProps) {
  const status = statusMap[project.status] || statusMap.DRAFT;
  const timeAgo = getTimeAgo(project.updatedAt);

  return (
    <Link
      href={`/projects/${project.id}/chat`}
      className="group bg-card border border-border rounded-xl p-5 hover:border-purple/30 transition-all hover:shadow-lg hover:shadow-purple/5"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <Film className="w-4 h-4 text-purple" />
          <span className={`text-xs font-medium ${status.color}`}>
            {status.label}
          </span>
        </div>
        <span className="text-xs text-muted-foreground">
          {project.aspectRatio.replace("W_", "").replace("_", ":")}
        </span>
      </div>

      <h3 className="font-medium text-sm mb-3 line-clamp-2 group-hover:text-purple transition-colors">
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
        </div>
        <span className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {timeAgo}
        </span>
      </div>
    </Link>
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
