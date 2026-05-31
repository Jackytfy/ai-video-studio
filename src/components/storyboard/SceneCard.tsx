"use client";

import { Film, Wand2, Edit3, ChevronDown, ChevronUp, User, Calendar, Video, Palette } from "lucide-react";
import { useState } from "react";

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

interface SceneCardProps {
  scene: Scene;
  onEdit: (scene: Scene) => void;
}

export function SceneCard({ scene, onEdit }: SceneCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isAnimation = scene.sceneType === "ANIMATION";

  let meta: any = null;
  if (scene.productionMeta) {
    try { meta = JSON.parse(scene.productionMeta); } catch {}
  }

  return (
    <div className="bg-card border border-border rounded-xl hover:border-purple/30 transition-all group">
      {/* Header */}
      <div className="p-4 pb-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="bg-purple/10 text-purple text-xs font-medium px-2 py-0.5 rounded-full">
              场景 {scene.sceneNumber}
            </span>
            {isAnimation ? (
              <Wand2 className="w-3 h-3 text-muted-foreground" />
            ) : (
              <Film className="w-3 h-3 text-muted-foreground" />
            )}
            <span className="text-[11px] text-muted-foreground">
              ~{scene.estimatedDuration ? Math.round(scene.estimatedDuration) : "—"}s
            </span>
          </div>
          <button
            onClick={() => onEdit(scene)}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-secondary rounded"
          >
            <Edit3 className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>

        {scene.title && (
          <h3 className="font-semibold text-sm mb-2">{scene.title}</h3>
        )}

        {/* Scripts */}
        {meta?.scripts && meta.scripts.length > 0 && (
          <div className="space-y-0.5 mb-2">
            {meta.scripts.slice(0, expanded ? undefined : 3).map((line: string, i: number) => (
              <p key={i} className="text-xs text-muted-foreground leading-relaxed">
                {line}
              </p>
            ))}
            {!expanded && meta.scripts.length > 3 && (
              <p className="text-[11px] text-purple cursor-pointer" onClick={() => setExpanded(true)}>
                展开全部 {meta.scripts.length} 条脚本...
              </p>
            )}
          </div>
        )}

        {/* Fallback: show voiceoverText if no scripts */}
        {(!meta?.scripts || meta.scripts.length === 0) && (
          <p className="text-xs text-muted-foreground line-clamp-3 mb-2">
            {scene.voiceoverText}
          </p>
        )}
      </div>

      {/* Expanded detail section */}
      {expanded && meta && (
        <div className="px-4 pb-3 space-y-2 border-t border-border/50 pt-2">
          {/* Proper Nouns */}
          {meta.properNouns && meta.properNouns.length > 0 && (
            <div className="flex items-start gap-1.5 text-[11px]">
              <User className="w-3 h-3 mt-0.5 text-purple shrink-0" />
              <span className="text-muted-foreground">
                {meta.properNouns.map((pn: any) => `${pn.name}（${pn.type}）`).join(" · ")}
              </span>
            </div>
          )}

          {/* Era */}
          {meta.era && (
            <div className="flex items-center gap-1.5 text-[11px]">
              <Calendar className="w-3 h-3 text-purple shrink-0" />
              <span className="text-muted-foreground">{meta.era}</span>
            </div>
          )}

          {/* Sources */}
          {meta.sources && meta.sources.length > 0 && (
            <div className="flex items-start gap-1.5 text-[11px]">
              <Video className="w-3 h-3 mt-0.5 text-purple shrink-0" />
              <span className="text-muted-foreground">{meta.sources.join("、")}</span>
            </div>
          )}

          {/* Preference */}
          {meta.preference && (
            <div className="flex items-start gap-1.5 text-[11px]">
              <Palette className="w-3 h-3 mt-0.5 text-purple shrink-0" />
              <span className="text-muted-foreground">{meta.preference}</span>
            </div>
          )}

          <button
            onClick={() => setExpanded(false)}
            className="flex items-center gap-1 text-[11px] text-purple hover:text-purple-light"
          >
            <ChevronUp className="w-3 h-3" />
            收起详情
          </button>
        </div>
      )}

      {/* Expand toggle (collapsed state) */}
      {!expanded && meta && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full px-4 pb-3 pt-1 flex items-center justify-center gap-1 text-[11px] text-muted-foreground hover:text-purple transition-colors"
        >
          <ChevronDown className="w-3 h-3" />
          查看制作详情
        </button>
      )}

      {/* Bottom stats (collapsed state) */}
      {!expanded && (
        <div className="px-4 pb-3 flex items-center gap-3 text-[11px] text-muted-foreground/60">
          <span>{scene.wordCount || "—"} 字</span>
          {meta?.era && <span>{meta.era.split(" / ")[0]}</span>}
          <span className="ml-auto">{scene.sceneType === "ANIMATION" ? "动画" : "实拍"}</span>
        </div>
      )}
    </div>
  );
}
