"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check, Loader2, Play, X, Sparkles, Film, Mic,
  Clock, Layers, FileText, Settings, Video, RefreshCw
} from "lucide-react";
import { SceneCard } from "@/components/storyboard/SceneCard";
import { SceneEditor } from "@/components/storyboard/SceneEditor";
import { ACTIVE_STATUSES } from "@/lib/state-machine-constants";

// States where a render is in progress (button should show "rendering")
const RENDERING_STATES = [...ACTIVE_STATUSES, "RENDERING"];

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

interface ProjectData {
  id: string;
  name: string;
  status: string;
  sourceText: string;
  aiAnalysis?: string | null;
  contentStyle: string;
  aspectRatio: string;
  renderJobs?: Array<{ status: string; outputUrl?: string }>;
}

export default function StoryboardPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const queryClient = useQueryClient();

  const [editingScene, setEditingScene] = useState<Scene | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState("");

  const { data: project } = useQuery<ProjectData>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("获取项目失败");
      return res.json();
    },
    // Poll while rendering to detect completion
    refetchInterval: (query) => {
      const status = (query.state.data as ProjectData | undefined)?.status;
      if (!status) return false;
      if (RENDERING_STATES.includes(status)) return 3000;
      return false;
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

  // Parse AI analysis for metadata panel
  const aiAnalysis = project?.aiAnalysis
    ? (typeof project.aiAnalysis === "string" ? JSON.parse(project.aiAnalysis) : project.aiAnalysis)
    : null;

  // Aggregate production metadata from all scenes
  const aggregatedMeta = (() => {
    if (!storyboard?.scenes) return null;
    const allScripts: string[] = [];
    const allProperNouns: Array<{ name: string; type: string }> = [];
    const eras = new Set<string>();
    const sources = new Set<string>();
    const preferences = new Set<string>();

    storyboard.scenes.forEach((scene) => {
      if (scene.productionMeta) {
        try {
          const meta = JSON.parse(scene.productionMeta);
          if (meta.scripts) allScripts.push(...meta.scripts);
          if (meta.properNouns) allProperNouns.push(...meta.properNouns);
          if (meta.era) eras.add(meta.era);
          if (meta.sources) meta.sources.forEach((s: string) => sources.add(s));
          if (meta.preference) preferences.add(meta.preference);
        } catch {}
      }
    });

    return {
      scripts: allScripts,
      properNouns: allProperNouns,
      era: Array.from(eras).join("、") || undefined,
      sources: Array.from(sources),
      preference: Array.from(preferences).join("；") || undefined,
    };
  })();

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
      queryClient.invalidateQueries({ queryKey: ["storyboard", projectId] });
    },
  });

  const renderMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/render`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "渲染失败");
      }
      return data;
    },
    onSuccess: (data) => {
      // Invalidate to trigger polling for render status
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      // Sync mode: redirect immediately (outputUrl is in response)
      if (data.outputUrl) {
        router.push(`/projects/${projectId}`);
      }
      // Async mode: project status changes to RENDERING, polling kicks in,
      // useEffect below detects COMPLETED → redirect
    },
  });

  // Auto-redirect when rendering completes
  const [hasStartedRender, setHasStartedRender] = useState(false);
  const projectStatus = project?.status ?? "";
  const isRendering = RENDERING_STATES.includes(projectStatus);
  const lastJob = project?.renderJobs?.[0];

  useEffect(() => {
    if (isRendering) setHasStartedRender(true);
  }, [isRendering]);

  useEffect(() => {
    if (
      hasStartedRender &&
      projectStatus === "COMPLETED" &&
      lastJob?.status === "COMPLETED"
    ) {
      router.push(`/projects/${projectId}`);
    }
  }, [projectStatus, lastJob?.status, hasStartedRender, projectId, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-7xl mx-auto p-6 space-y-6 animate-pulse">
          <div className="h-12 bg-secondary rounded-lg w-48" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 h-40 bg-secondary rounded-xl" />
            <div className="h-40 bg-secondary rounded-xl" />
          </div>
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-32 bg-secondary rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!storyboard || !project) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">分镜脚本不存在</p>
      </div>
    );
  }

  const isConfirmed = storyboard.status === "CONFIRMED";
  // Show "rendering" state if mutation is pending OR project is in a rendering state
  const isGenerating = renderMutation.isPending || isRendering;

  // Scene type label mapping
  const sceneTypeLabel: Record<string, string> = {
    REAL_FOOTAGE: "视频素材",
    ANIMATION: "动画素材",
    AI_GENERATED: "AI生成",
    CUSTOM: "自定义",
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-md border-b border-border">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-purple" />
            <h1 className="text-lg font-semibold">创作规划书</h1>
          </div>
          <button
            onClick={() => router.push(`/projects/${projectId}`)}
            className="p-2 hover:bg-secondary rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
        {/* Top Section: Script (Left) + Metadata (Right) */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: Source Text */}
          <div className="lg:col-span-2 bg-card border border-border rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-border flex items-center gap-2">
              <FileText className="w-4 h-4 text-purple" />
              <span className="text-sm font-medium">原始文稿</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {project.sourceText.length} 字符
              </span>
            </div>
            <div className="p-5 max-h-[280px] overflow-y-auto">
              <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {project.sourceText}
              </p>
            </div>
          </div>

          {/* Right: Metadata Panel */}
          <div className="space-y-4">
            {/* 画面构建 */}
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Film className="w-4 h-4 text-purple" />
                  <span className="text-sm font-medium">画面构建</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  视频素材匹配：{storyboard.totalScenes} 个场景
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Layers className="w-3 h-3" /> {storyboard.totalScenes} 个场景
                </span>
                {storyboard.totalDuration && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> ~{Math.round(storyboard.totalDuration)}s
                  </span>
                )}
                {storyboard.totalWords && (
                  <span className="flex items-center gap-1">
                    <FileText className="w-3 h-3" /> {storyboard.totalWords} 字
                  </span>
                )}
              </div>
            </div>

            {/* 旁白配置 */}
            <div className="bg-card border border-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Mic className="w-4 h-4 text-purple" />
                  <span className="text-sm font-medium">旁白配置</span>
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple/10 text-purple">
                  全文
                </span>
              </div>
              <div className="flex gap-2">
                <select className="flex-1 text-xs bg-secondary border border-border rounded-lg px-3 py-2 text-foreground focus:outline-none focus:border-purple">
                  <option>zh-CN-YunxiNeural（男-云希）</option>
                  <option>zh-CN-XiaoyiNeural（女-小艺）</option>
                  <option>zh-CN-YunjianNeural（男-云健）</option>
                </select>
              </div>
            </div>

            {/* Production Meta Info */}
            {aggregatedMeta && (
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                {/* 素材偏好 */}
                {aiAnalysis && (
                  <>
                    <div>
                      <div className="text-xs text-foreground font-medium mb-1">
                        · <strong>素材偏好：</strong>{project.contentStyle === "CLASSIC_HISTORY" ? "历史纪录片片段、古装剧场景、古风动画、城市航拍、文物特写" : project.contentStyle === "CULTURE" ? "文化纪录片、人文风光、非遗展示、城市风貌" : "知识科普类视频素材、信息图表、实景拍摄"}
                      </div>
                    </div>
                    {/* 推荐参考 */}
                    {aggregatedMeta.sources.length > 0 && (
                      <div>
                        <div className="text-xs text-foreground font-medium mb-1">
                          · <strong>推荐参考：</strong>{aggregatedMeta.sources.slice(0, 5).join("、")}《{aggregatedMeta.sources[0] || "相关纪录片"}》等相关影像
                        </div>
                      </div>
                    )}
                  </>
                )}

                {/* 素材倾向 */}
                {aggregatedMeta.preference && (
                  <div>
                    <div className="text-xs text-foreground font-medium mb-1">
                      · <strong>素材倾向：</strong>{aggregatedMeta.preference}
                    </div>
                  </div>
                )}

                {/* 时效性 */}
                {aggregatedMeta.era && (
                  <div>
                    <div className="text-xs text-foreground font-medium mb-1">
                      · <strong>时效性：</strong>历史内容需使用{aggregatedMeta.era}时期场景素材
                    </div>
                  </div>
                )}

                {/* 专家要求 / 专名清单 */}
                {aggregatedMeta.properNouns.length > 0 && (
                  <div>
                    <div className="text-xs text-foreground font-medium mb-1">
                      · <strong>专家要求：</strong>素材中需出现
                      {aggregatedMeta.properNouns.slice(0, 8).map((n) => n.name).join("、")}
                      {aggregatedMeta.properNouns.length > 8 ? "等标志性元素需重点呈现" : "等标志性元素"}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Status message */}
            <div className="rounded-xl p-3 bg-purple/5 border border-purple/20">
              <div className="flex items-start gap-2">
                <Settings className="w-4 h-4 text-purple mt-0.5 shrink-0" />
                <div className="text-xs text-muted-foreground leading-relaxed">
                  <p className="text-foreground font-medium mb-1">现在让我将基础信息写入项目，并生成拆分方案：</p>
                  <p>更新创作信息...</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Scene List - Table Format */}
        <div className="space-y-4">
          {/* Column Headers */}
          <div className="grid grid-cols-12 gap-4 px-2 text-xs text-muted-foreground font-medium">
            <div className="col-span-2">画面类型</div>
            <div className="col-span-5">口播脚本</div>
            <div className="col-span-3">素材检索</div>
            <div className="col-span-2">画面描述</div>
          </div>

          {/* Scene Cards */}
          <div className="space-y-3">
            {storyboard.scenes.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                onEdit={(s) => setEditingScene(s)}
              />
            ))}
          </div>
        </div>

        {/* Bottom Action Bar */}
        <div className="sticky bottom-0 bg-background/90 backdrop-blur-md border-t border-border -mx-6 px-6 py-4 flex items-center justify-between">
          <button
            onClick={() => setShowNotes(!showNotes)}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {showNotes ? "收起备注" : "输入你的任何想法"}
          </button>

          {isGenerating ? (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 bg-gray-600 text-white px-8 py-2.5 rounded-full font-medium cursor-not-allowed">
                <Loader2 className="w-4 h-4 animate-spin" />
                {projectStatus === "RENDERING" ? "渲染中..." : "生成中..."}
              </div>
              <span className="text-xs text-muted-foreground">
                完成后自动跳转
              </span>
            </div>
          ) : projectStatus === "FAILED" ? (
            <button
              onClick={() => renderMutation.mutate()}
              className="flex items-center gap-2 bg-gradient-to-r from-orange-500 to-red-400 text-white px-8 py-2.5 rounded-full font-medium hover:opacity-90 transition-opacity shadow-lg shadow-orange/20"
            >
              <Play className="w-4 h-4" />
              重新渲染
            </button>
          ) : projectStatus === "COMPLETED" && lastJob?.outputUrl ? (
            <div className="flex items-center gap-3">
              <button
                onClick={() => renderMutation.mutate()}
                disabled={renderMutation.isPending}
                className="flex items-center gap-2 bg-gradient-to-r from-orange-500 to-red-400 text-white px-6 py-2.5 rounded-full font-medium hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg shadow-orange/20"
              >
                {renderMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                {renderMutation.isPending ? "重新生成中..." : "重新生成"}
              </button>
              <button
                onClick={() => router.push(`/projects/${projectId}`)}
                className="flex items-center gap-2 bg-gradient-to-r from-green-500 to-emerald-400 text-white px-8 py-2.5 rounded-full font-medium hover:opacity-90 transition-opacity shadow-lg shadow-green/20"
              >
                <Video className="w-4 h-4" />
                查看视频
              </button>
            </div>
          ) : !isConfirmed ? (
            <button
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending}
              className="flex items-center gap-2 bg-gradient-to-r from-purple to-pink-400 text-white px-8 py-2.5 rounded-full font-medium hover:opacity-90 transition-opacity disabled:opacity-50 shadow-lg shadow-purple/20"
            >
              {confirmMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              确认并继续
            </button>
          ) : (
            <button
              onClick={() => renderMutation.mutate()}
              className="flex items-center gap-2 bg-gradient-to-r from-purple to-pink-400 text-white px-8 py-2.5 rounded-full font-medium hover:opacity-90 transition-opacity shadow-lg shadow-purple/20"
            >
              <Play className="w-4 h-4" />
              生成视频
            </button>
          )}
        </div>

        {/* Notes Input (Expandable) */}
        {showNotes && (
          <div className="pb-4">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="添加备注或修改建议..."
              className="w-full bg-card border border-border rounded-xl p-4 text-sm resize-none focus:outline-none focus:border-purple min-h-[100px]"
              rows={4}
            />
          </div>
        )}
      </div>

      {/* Scene Editor Modal */}
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
