"use client";

import { BookOpen, Mic, Film, Eye, ChevronDown, ChevronUp, X, Search, Edit3 } from "lucide-react";
import { useState, useCallback } from "react";
import Link from "next/link";

interface StoryboardScene {
  sceneNumber: number;
  title: string;
  sceneType: string;
  voiceoverText: string;
  visualDesc: string;
  materialQuery: string;
}

interface StoryboardBookData {
  title: string;
  totalScenes: number;
  totalDuration: number;
  totalWords: number;
  scenes: StoryboardScene[];
}

interface StoryboardBookCardProps {
  projectId: string;
  data: StoryboardBookData;
}

export function StoryboardBookCard({ projectId, data }: StoryboardBookCardProps) {
  const [expanded, setExpanded] = useState(false);

  const openModal = useCallback(() => setExpanded(true), []);
  const closeModal = useCallback(() => setExpanded(false), []);

  return (
    <>
      {/* Inline card preview */}
      <div className="bg-card border border-border rounded-xl p-5 max-w-lg space-y-4">
        <div className="flex items-center gap-2 text-purple">
          <BookOpen className="w-4 h-4" />
          <span className="font-semibold text-sm">创作规划书</span>
        </div>

        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Film className="w-3 h-3" />
            {data.totalScenes} 个场景
          </span>
          <span>约 {Math.round(data.totalDuration)} 秒</span>
          <span>{data.totalWords} 字</span>
        </div>

        {/* Scene preview thumbnails */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {data.scenes.slice(0, 5).map((scene) => (
            <div
              key={scene.sceneNumber}
              className="flex-shrink-0 w-20 h-14 bg-secondary rounded-md flex items-center justify-center text-[10px] text-muted-foreground border border-border"
            >
              {String(scene.sceneNumber).padStart(2, "0")}
            </div>
          ))}
          {data.scenes.length > 5 && (
            <div className="flex-shrink-0 w-20 h-14 bg-secondary rounded-md flex items-center justify-center text-[10px] text-muted-foreground border border-border">
              +{data.scenes.length - 5}
            </div>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={openModal}
            className="flex-1 flex items-center justify-center gap-1.5 bg-purple hover:bg-purple-light text-white py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Eye className="w-3.5 h-3.5" />
            查看完整规划书
          </button>
          <Link
            href={`/projects/${projectId}/storyboard`}
            className="flex items-center justify-center gap-1.5 px-4 py-2 border border-border rounded-lg text-sm text-muted-foreground hover:text-foreground hover:border-purple/50 transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
            编辑
          </Link>
        </div>
      </div>

      {/* Full-screen modal */}
      {expanded && (
        <StoryboardBookModal
          projectId={projectId}
          data={data}
          onClose={closeModal}
        />
      )}
    </>
  );
}

function StoryboardBookModal({
  projectId,
  data,
  onClose,
}: {
  projectId: string;
  data: StoryboardBookData;
  onClose: () => void;
}) {
  const [activeScene, setActiveScene] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredScenes = searchQuery
    ? data.scenes.filter(
        (s) =>
          s.title.includes(searchQuery) ||
          s.voiceoverText.includes(searchQuery) ||
          s.visualDesc.includes(searchQuery) ||
          s.materialQuery.includes(searchQuery)
      )
    : data.scenes;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-background border border-border rounded-2xl w-[90vw] max-w-4xl max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-3">
            <BookOpen className="w-5 h-5 text-purple" />
            <h2 className="text-lg font-semibold">创作规划书</h2>
            <span className="text-xs text-muted-foreground">
              {data.totalScenes} 场景 · 约{Math.round(data.totalDuration)}秒 · {data.totalWords}字
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search bar */}
        <div className="px-6 py-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索场景内容..."
              className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple"
            />
          </div>
        </div>

        {/* Scene list */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {/* Column headers */}
          <div className="grid grid-cols-12 gap-3 text-[10px] text-muted-foreground font-medium px-3 sticky top-0 bg-background py-1">
            <div className="col-span-1">序号</div>
            <div className="col-span-2">类型</div>
            <div className="col-span-3">口播脚本</div>
            <div className="col-span-3">画面描述</div>
            <div className="col-span-3">素材检索</div>
          </div>

          {filteredScenes.map((scene) => (
            <div
              key={scene.sceneNumber}
              className={`bg-card border rounded-xl p-4 cursor-pointer transition-colors ${
                activeScene === scene.sceneNumber
                  ? "border-purple"
                  : "border-border hover:border-purple/30"
              }`}
              onClick={() =>
                setActiveScene(
                  activeScene === scene.sceneNumber ? null : scene.sceneNumber
                )
              }
            >
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-1">
                  <span className="text-sm font-semibold text-purple">
                    {String(scene.sceneNumber).padStart(2, "0")}
                  </span>
                </div>
                <div className="col-span-2">
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple/10 text-purple">
                    {scene.sceneType === "REAL_FOOTAGE" ? "实拍" : "动画"}
                  </span>
                  {scene.title && (
                    <p className="text-[11px] text-muted-foreground mt-1 truncate">
                      {scene.title}
                    </p>
                  )}
                </div>
                <div className="col-span-3">
                  <p className={`text-xs text-foreground ${activeScene === scene.sceneNumber ? "" : "line-clamp-3"}`}>
                    {scene.voiceoverText}
                  </p>
                </div>
                <div className="col-span-3">
                  <p className={`text-xs text-muted-foreground ${activeScene === scene.sceneNumber ? "" : "line-clamp-3"}`}>
                    {scene.visualDesc}
                  </p>
                </div>
                <div className="col-span-3">
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {scene.materialQuery}
                  </p>
                </div>
              </div>

              {/* Expanded detail */}
              {activeScene === scene.sceneNumber && (
                <div className="mt-3 pt-3 border-t border-border space-y-2">
                  <div>
                    <span className="text-[10px] text-muted-foreground font-medium">完整口播脚本</span>
                    <p className="text-xs text-foreground mt-1 whitespace-pre-wrap">
                      {scene.voiceoverText}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] text-muted-foreground font-medium">完整画面描述</span>
                    <p className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap">
                      {scene.visualDesc}
                    </p>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Link
                      href={`/projects/${projectId}/editor?scene=${scene.sceneNumber}`}
                      className="text-[11px] text-purple hover:text-purple-light transition-colors flex items-center gap-1"
                      onClick={onClose}
                    >
                      <Edit3 className="w-3 h-3" />
                      编辑此场景
                    </Link>
                  </div>
                </div>
              )}
            </div>
          ))}

          {filteredScenes.length === 0 && (
            <div className="text-center py-8 text-muted-foreground text-sm">
              未找到匹配的场景
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            {filteredScenes.length} / {data.totalScenes} 个场景
          </span>
          <Link
            href={`/projects/${projectId}/storyboard`}
            className="flex items-center gap-2 bg-purple hover:bg-purple-light text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors"
            onClick={onClose}
          >
            <Edit3 className="w-4 h-4" />
            编辑分镜
          </Link>
        </div>
      </div>
    </div>
  );
}
