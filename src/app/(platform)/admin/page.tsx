"use client";

import { useQuery } from "@tanstack/react-query";
import { Users, Film, Shield, Activity } from "lucide-react";

interface AdminStats {
  userCount: number;
  projectCount: number;
  adminCount: number;
  recentUsers: {
    id: string;
    name: string | null;
    email: string;
    role: string;
    createdAt: string;
    _count: { projects: number };
  }[];
  projectStatusDistribution: { status: string; count: number }[];
}

const statusLabels: Record<string, string> = {
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

export default function AdminPage() {
  const { data, isLoading } = useQuery<AdminStats>({
    queryKey: ["adminStats"],
    queryFn: async () => {
      const res = await fetch("/api/admin/stats");
      if (!res.ok) throw new Error("获取数据失败");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 animate-pulse space-y-4">
        <div className="h-8 bg-secondary rounded w-1/4" />
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 bg-secondary rounded-xl" />
          ))}
        </div>
        <div className="h-64 bg-secondary rounded-xl" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">后台管理</h1>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-purple/10 flex items-center justify-center">
            <Users className="w-5 h-5 text-purple" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">用户总数</p>
            <p className="text-2xl font-bold">{data?.userCount ?? 0}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
            <Film className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">项目总数</p>
            <p className="text-2xl font-bold">{data?.projectCount ?? 0}</p>
          </div>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <p className="text-sm text-muted-foreground">管理员</p>
            <p className="text-2xl font-bold">{data?.adminCount ?? 0}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold">项目状态分布</h2>
          </div>
          <div className="space-y-2">
            {(data?.projectStatusDistribution ?? []).map((s) => (
              <div key={s.status} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{statusLabels[s.status] || s.status}</span>
                <span className="font-medium">{s.count}</span>
              </div>
            ))}
            {(!data?.projectStatusDistribution || data.projectStatusDistribution.length === 0) && (
              <p className="text-sm text-muted-foreground">暂无数据</p>
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h2 className="font-semibold">最近注册用户</h2>
          </div>
          <div className="space-y-2">
            {(data?.recentUsers ?? []).map((user) => (
              <div key={user.id} className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0">
                <div>
                  <span className="font-medium">{user.name || "未设置"}</span>
                  <span className="text-muted-foreground ml-2">{user.email}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{user._count.projects} 个项目</span>
                  {user.role === "ADMIN" && (
                    <span className="text-amber-400 font-medium">管理员</span>
                  )}
                </div>
              </div>
            ))}
            {(!data?.recentUsers || data.recentUsers.length === 0) && (
              <p className="text-sm text-muted-foreground">暂无用户</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
