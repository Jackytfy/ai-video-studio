"use client";

import { Film, Wand2, Edit3, ChevronDown, ChevronUp, Search, Eye, Mic } from "lucide-react";
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

  // Voiceover scripts: from meta.scripts or split voiceoverText
  const voiceoverScripts: string[] = meta?.scripts && meta.scripts.length > 0
    ? meta.scripts
    : (scene.voiceoverText ? [scene.voiceoverText] : []);

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

        {/* Voiceover Scripts (口播脚本) - always visible */}
        {voiceoverScripts.length > 0 && (
          <div className="space-y-0.5 mb-2">
            <div className="flex items-center gap-1 text-[11px] text-purple/80 mb-0.5">
              <Mic className="w-3 h-3" />
              <span>口播脚本</span>
            </div>
            {voiceoverScripts.slice(0, expanded ? undefined : 2).map((line: string, i: number) => (
              <p key={i} className="text-xs text-muted-foreground leading-relaxed pl-4">
                {line}
              </p>
            ))}
            {!expanded && voiceoverScripts.length > 2 && (
              <p className="text-[11px] text-purple cursor-pointer pl-4" onClick={() => setExpanded(true)}>
                展开全部 {voiceoverScripts.length} 条脚本...
              </p>
            )}
          </div>
        )}

        {/* Visual Description (画面描述) - always visible */}
        {scene.visualDesc && (
          <div className="mb-2">
            <div className="flex items-center gap-1 text-[11px] text-purple/80 mb-0.5">
              <Eye className="w-3 h-3" />
              <span>画面描述</span>
            </div>
            <p className={`text-xs text-muted-foreground leading-relaxed pl-4 ${expanded ? "" : "line-clamp-2"}`}>
              {scene.visualDesc}
            </p>
          </div>
        )}
      </div>

      {/* Expanded detail section */}
      {expanded && (
        <div className="px-4 pb-3 space-y-2 border-t border-border/50 pt-2">
          {/* Material Query (素材检索) */}
          {scene.materialQuery && (
            <div className="flex items-start gap-1.5 text-[11px]">
              <Search className="w-3 h-3 mt-0.5 text-purple shrink-0" />
              <div>
                <span className="text-purple/80 font-medium">素材检索：</span>
                <span className="text-muted-foreground">{scene.materialQuery}</span>
              </div>
            </div>
          )}

          {/* Full voiceover text */}
          {scene.voiceoverText && voiceoverScripts.length > 1 && (
            <div className="flex items-start gap-1.5 text-[11px]">
              <Mic className="w-3 h-3 mt-0.5 text-purple shrink-0" />
              <div>
                <span className="text-purple/80 font-medium">完整口播：</span>
                <span className="text-muted-foreground">{scene.voiceoverText}</span>
              </div>
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
      {!expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full px-4 pb-3 pt-1 flex items-center justify-center gap-1 text-[11px] text-muted-foreground hover:text-purple transition-colors"
        >
          <ChevronDown className="w-3 h-3" />
          查看详情
        </button>
      )}
    </div>
  );
}
