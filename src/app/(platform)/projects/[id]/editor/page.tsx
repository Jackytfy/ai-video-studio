"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  VideoTimeline,
  TimelineSegment,
} from "@/components/editor/VideoTimeline";
import { SegmentRecorder } from "@/components/editor/SegmentRecorder";
import { VideoTrimmer } from "@/components/editor/VideoTrimmer";
import { MusicSelector } from "@/components/editor/MusicSelector";
import { AutoMatchPanel } from "@/components/editor/AutoMatchPanel";
import {
  Plus,
  Wand2,
  Play,
  Loader2,
  Check,
  ArrowLeft,
  Film,
  Music,
  Layers,
  Sparkles,
} from "lucide-react";

interface Project {
  id: string;
  name: string;
  sourceText: string;
  status: string;
}

interface MusicTrack {
  id: string;
  name: string;
  fileUrl: string;
  duration: number;
  volume: number;
  mood?: string;
  genre?: string;
  isBgm: boolean;
}

type EditorTab = "segments" | "music" | "automatch";

export default function VideoEditorPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<EditorTab>("automatch");
  const [showRecorder, setShowRecorder] = useState(false);
  const [trimmingSegment, setTrimmingSegment] =
    useState<TimelineSegment | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>();
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRendering, setIsRendering] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch project
  const { data: project } = useQuery<Project>({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("获取项目失败");
      return res.json();
    },
  });

  // Fetch segments
  const { data: segments = [] } = useQuery<TimelineSegment[]>({
    queryKey: ["segments", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/segments`);
      if (!res.ok) throw new Error("获取片段失败");
      return res.json();
    },
  });

  // Fetch music tracks
  const { data: musicTracks = [] } = useQuery<MusicTrack[]>({
    queryKey: ["musicTracks", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/music`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Calculate total duration
  const totalDuration = segments.reduce((sum, seg) => {
    const duration =
      (seg.trimEnd ?? seg.duration) - (seg.trimStart ?? 0);
    return sum + duration;
  }, 0);

  // Reorder mutation
  const reorderMutation = useMutation({
    mutationFn: async (reordered: TimelineSegment[]) => {
      const res = await fetch(`/api/projects/${projectId}/segments/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segmentIds: reordered.map((s) => s.id),
        }),
      });
      if (!res.ok) throw new Error("排序失败");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["segments", projectId] });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (segmentId: string) => {
      const res = await fetch(
        `/api/projects/${projectId}/segments/${segmentId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("删除失败");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["segments", projectId] });
    },
  });

  // Trim mutation
  const trimMutation = useMutation({
    mutationFn: async ({
      segmentId,
      trimStart,
      trimEnd,
    }: {
      segmentId: string;
      trimStart: number;
      trimEnd: number;
    }) => {
      const res = await fetch(
        `/api/projects/${projectId}/segments/${segmentId}/trim`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trimStart, trimEnd }),
        }
      );
      if (!res.ok) throw new Error("裁剪失败");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["segments", projectId] });
      setTrimmingSegment(null);
    },
  });

  // Render mutation
  const renderMutation = useMutation({
    mutationFn: async () => {
      setIsRendering(true);
      const res = await fetch(`/api/projects/${projectId}/render-editor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          segmentIds: segments.map((s) => s.id),
          musicTrackIds: musicTracks.map((t) => t.id),
        }),
      });
      if (!res.ok) throw new Error("渲染失败");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onSettled: () => {
      setIsRendering(false);
    },
  });

  // Playback controls
  const handlePlay = useCallback(() => {
    setIsPlaying(true);
    setCurrentTime(0);

    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
    }

    playIntervalRef.current = setInterval(() => {
      setCurrentTime((prev) => {
        if (prev >= totalDuration) {
          setIsPlaying(false);
          if (playIntervalRef.current) {
            clearInterval(playIntervalRef.current);
          }
          return 0;
        }
        return prev + 0.1;
      });
    }, 100);
  }, [totalDuration]);

  const handlePause = useCallback(() => {
    setIsPlaying(false);
    if (playIntervalRef.current) {
      clearInterval(playIntervalRef.current);
    }
  }, []);

  const handleSeek = useCallback(
    (time: number) => {
      setCurrentTime(Math.min(time, totalDuration));
    },
    [totalDuration]
  );

  useEffect(() => {
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, []);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push(`/projects/${projectId}`)}
            className="p-2 hover:bg-secondary rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-lg font-semibold">视频编辑器</h1>
            <p className="text-sm text-muted-foreground">
              {project?.name || "加载中..."}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary px-3 py-1.5 rounded-lg">
            <Film className="w-4 h-4" />
            <span>{segments.length} 片段</span>
            <span>·</span>
            <span>{formatTime(totalDuration)}</span>
          </div>

          <button
            onClick={() => renderMutation.mutate()}
            disabled={segments.length === 0 || isRendering}
            className="flex items-center gap-2 px-4 py-2 bg-purple hover:bg-purple-light text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isRendering ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {isRendering ? "渲染中..." : "生成视频"}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel - Timeline */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Preview area */}
          <div className="flex-1 flex items-center justify-center bg-black/5 min-h-0">
            {segments.length > 0 ? (
              <div className="relative w-full max-w-2xl aspect-video bg-black rounded-lg overflow-hidden">
                {/* Find current segment based on currentTime */}
                {(() => {
                  let elapsed = 0;
                  const currentSeg = segments.find((seg) => {
                    const segDuration =
                      (seg.trimEnd ?? seg.duration) - (seg.trimStart ?? 0);
                    if (
                      currentTime >= elapsed &&
                      currentTime < elapsed + segDuration
                    ) {
                      return true;
                    }
                    elapsed += segDuration;
                    return false;
                  });

                  return currentSeg ? (
                    <video
                      src={currentSeg.fileUrl}
                      className="w-full h-full object-contain"
                      muted
                      autoPlay={isPlaying}
                    />
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground">
                      <Film className="w-12 h-12" />
                    </div>
                  );
                })()}

                {/* Time overlay */}
                <div className="absolute bottom-4 left-4 bg-black/60 px-3 py-1 rounded text-sm font-mono text-white">
                  {formatTime(currentTime)} / {formatTime(totalDuration)}
                </div>
              </div>
            ) : (
              <div className="text-center space-y-4">
                <div className="w-20 h-20 rounded-full bg-purple/10 flex items-center justify-center mx-auto">
                  <Film className="w-10 h-10 text-purple" />
                </div>
                <div>
                  <p className="text-lg font-medium">开始创作你的视频</p>
                  <p className="text-sm text-muted-foreground">
                    上传视频片段或使用 AI 智能匹配自动生成
                  </p>
                </div>
                <button
                  onClick={() => setShowRecorder(true)}
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-purple hover:bg-purple-light text-white rounded-lg text-sm font-medium transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  添加视频片段
                </button>
              </div>
            )}
          </div>

          {/* Timeline */}
          <div className="p-4 border-t border-border">
            <VideoTimeline
              segments={segments}
              totalDuration={totalDuration}
              currentTime={currentTime}
              isPlaying={isPlaying}
              onPlay={handlePlay}
              onPause={handlePause}
              onSeek={handleSeek}
              onReorder={(reordered) => reorderMutation.mutate(reordered)}
              onTrim={(segmentId) => {
                const seg = segments.find((s) => s.id === segmentId);
                if (seg) setTrimmingSegment(seg);
              }}
              onDelete={(segmentId) => deleteMutation.mutate(segmentId)}
              onSelect={(seg) => setSelectedSegmentId(seg.id)}
              selectedId={selectedSegmentId}
            />
          </div>
        </div>

        {/* Right panel - Tools */}
        <div className="w-96 border-l border-border overflow-y-auto">
          {/* Tabs */}
          <div className="flex border-b border-border">
            {[
              { key: "automatch" as const, label: "AI 匹配", icon: Wand2 },
              { key: "segments" as const, label: "片段", icon: Film },
              { key: "music" as const, label: "音乐", icon: Music },
            ].map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? "text-purple border-b-2 border-purple"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <tab.icon className="w-4 h-4" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-4">
            {activeTab === "automatch" && (
              <AutoMatchPanel
                projectId={projectId}
                scriptContent={project?.sourceText || ""}
                onApplyMatches={() => {
                  queryClient.invalidateQueries({
                    queryKey: ["storyboard", projectId],
                  });
                }}
              />
            )}

            {activeTab === "segments" && (
              <div className="space-y-4">
                <button
                  onClick={() => setShowRecorder(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 border-2 border-dashed border-border rounded-xl hover:border-purple/50 transition-colors text-sm"
                >
                  <Plus className="w-4 h-4" />
                  添加视频片段
                </button>

                {segments.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">
                      片段列表（拖拽排序）
                    </p>
                    {segments.map((seg, i) => (
                      <div
                        key={seg.id}
                        className="flex items-center gap-3 bg-secondary rounded-lg p-3 cursor-pointer hover:bg-secondary/80 transition-colors"
                        onClick={() => setSelectedSegmentId(seg.id)}
                      >
                        {seg.thumbnailUrl ? (
                          <img
                            src={seg.thumbnailUrl}
                            alt=""
                            className="w-16 h-10 object-cover rounded"
                          />
                        ) : (
                          <div className="w-16 h-10 bg-secondary rounded flex items-center justify-center">
                            <Film className="w-4 h-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm truncate">{seg.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatTime(
                              (seg.trimEnd ?? seg.duration) -
                                (seg.trimStart ?? 0)
                            )}
                          </p>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setTrimmingSegment(seg);
                          }}
                          className="p-1.5 hover:bg-secondary rounded transition-colors"
                        >
                          <Layers className="w-4 h-4 text-muted-foreground" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "music" && (
              <MusicSelector
                projectId={projectId}
                tracks={musicTracks}
                scriptContent={project?.sourceText}
                onTracksChange={(tracks) => {
                  queryClient.invalidateQueries({
                    queryKey: ["musicTracks", projectId],
                  });
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {showRecorder && (
        <SegmentRecorder
          projectId={projectId}
          onSegmentAdded={() => {
            queryClient.invalidateQueries({
              queryKey: ["segments", projectId],
            });
          }}
          onClose={() => setShowRecorder(false)}
        />
      )}

      {trimmingSegment && (
        <VideoTrimmer
          videoUrl={trimmingSegment.fileUrl}
          duration={trimmingSegment.duration}
          initialStart={trimmingSegment.trimStart}
          initialEnd={trimmingSegment.trimEnd}
          onConfirm={(trimStart, trimEnd) => {
            trimMutation.mutate({
              segmentId: trimmingSegment.id,
              trimStart,
              trimEnd,
            });
          }}
          onClose={() => setTrimmingSegment(null)}
        />
      )}
    </div>
  );
}
