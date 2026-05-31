"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { StoryboardSummary } from "@/components/storyboard/StoryboardSummary";
import { StoryboardTimeline } from "@/components/storyboard/StoryboardTimeline";
import { SceneEditor } from "@/components/storyboard/SceneEditor";
import { Check, Loader2, Play, RefreshCw } from "lucide-react";

interface Scene {
  id: string;
  sceneNumber: number;
  title: string | null;
  sceneType: string;
  voiceoverText: string;
  visualDesc: string;
  materialQuery: string;
  productionMeta?: string | null;
  wordCount: number | null;
  estimatedDuration: number | null;
}

interface Storyboard {
  id: string;
  title: string | null;
  totalScenes: number;
  totalDuration: number | null;
  totalWords: number | null;
  status: string;
  scenes: Scene[];
}

export default function StoryboardPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const queryClient = useQueryClient();

  const [editingScene, setEditingScene] = useState<Scene | null>(null);

  const { data: project } = useQuery<{ id: string; status: string }>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("获取项目失败");
      return res.json();
    },
  });

  const { data: storyboard, isLoading } = useQuery<Storyboard>({
    queryKey: ["storyboard", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/storyboard`);
      if (!res.ok) throw new Error("获取分镜失败");
      return res.json();
    },
  });

  const updateSceneMutation = useMutation({
    mutationFn: async ({
      sceneId,
      data,
    }: {
      sceneId: string;
      data: Partial<Scene>;
    }) => {
      const res = await fetch(
        `/api/projects/${projectId}/storyboard/scenes/${sceneId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        }
      );
      if (!res.ok) throw new Error("更新场景失败");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["storyboard", projectId] });
      setEditingScene(null);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(
        `/api/projects/${projectId}/storyboard/confirm`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error("确认分镜失败");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      router.push(`/projects/${projectId}`);
    },
  });

  const renderMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/render`, {
        method: "POST",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "渲染失败");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      if (data.outputUrl) {
        router.push(`/projects/${projectId}`);
      }
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <div className="h-20 bg-secondary rounded-xl" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-48 bg-secondary rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!storyboard) {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>分镜脚本不存在</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <StoryboardSummary
        title={storyboard.title}
        totalScenes={storyboard.totalScenes}
        totalDuration={storyboard.totalDuration}
        totalWords={storyboard.totalWords}
        status={storyboard.status}
      />

      <StoryboardTimeline
        scenes={storyboard.scenes}
        onEditScene={setEditingScene}
      />

      <div className="flex justify-end gap-3">
        {storyboard.status !== "CONFIRMED" && (
          <button
            onClick={() => confirmMutation.mutate()}
            disabled={confirmMutation.isPending}
            className="flex items-center gap-2 bg-purple hover:bg-purple-light text-white px-6 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {confirmMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            确认分镜
          </button>
        )}

        {storyboard.status === "CONFIRMED" && (
          <button
            onClick={() => renderMutation.mutate()}
            disabled={renderMutation.isPending}
            className="flex items-center gap-2 bg-purple hover:bg-purple-light text-white px-6 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {renderMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {renderMutation.isPending ? "渲染中..." : "生成视频"}
          </button>
        )}
      </div>

      {editingScene && (
        <SceneEditor
          scene={editingScene}
          onSave={(sceneId, data) =>
            updateSceneMutation.mutate({ sceneId, data })
          }
          onClose={() => setEditingScene(null)}
          isSaving={updateSceneMutation.isPending}
        />
      )}
    </div>
  );
}
