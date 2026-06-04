"use client";

import { Film, Wand2, Edit3, Mic, Search, Eye } from "lucide-react";
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

const sceneTypeLabel: Record<string, { label: string; icon: typeof Film }> = {
  REAL_FOOTAGE: { label: "视频素材", icon: Film },
  ANIMATION: { label: "动画素材", icon: Wand2 },
  AI_GENERATED: { label: "AI生成", icon: Wand2 },
  CUSTOM: { label: "自定义", icon: Film },
};

export function SceneCard({ scene, onEdit }: SceneCardProps) {
  const [expanded, setExpanded] = useState(false);

  let meta: any = null;
  if (scene.productionMeta) {
    try { meta = JSON.parse(scene.productionMeta); } catch {}
  }

  const typeInfo = sceneTypeLabel[scene.sceneType] || sceneTypeLabel.REAL_FOOTAGE;
  const TypeIcon = typeInfo.icon;

  // Voiceover scripts: from meta.scripts or split voiceoverText
  const voiceoverScripts: string[] = meta?.scripts && meta.scripts.length > 0
    ? meta.scripts
    : (scene.voiceoverText ? [scene.voiceoverText] : []);

  // Material search info
  const materialLines: string[] = [];

  // Primary: AI-generated search query
  if (meta?.materialQuery) {
    materialLines.push(`检索词：${meta.materialQuery}`);
  } else if (scene.materialQuery) {
    materialLines.push(`检索词：${scene.materialQuery}`);
  }

  // Proper nouns
  if (meta?.properNouns && Array.isArray(meta.properNouns) && meta.properNouns.length > 0) {
    materialLines.push(`专名：${meta.properNouns.map((n: any) => n.name).join("、")}`);
  }

  // Era
  if (meta?.era) {
    materialLines.push(`年代：${meta.era}`);
  }

  // Sources
  if (meta?.sources && Array.isArray(meta.sources) && meta.sources.length > 0) {
    materialLines.push(`来源：${meta.sources.join("、")}`);
  }

  if (materialLines.length === 0) {
    materialLines.push("待检索");
  }

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden hover:border-purple/30 transition-all group">
      {/* Scene Title Header */}
      <div className="px-5 py-3 bg-secondary/30 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            场景{String(scene.sceneNumber).padStart(2, "0")}
          </span>
          {scene.title && (
            <>
              <span className="text-muted-foreground">·</span>
              <span className="text-sm font-medium text-foreground">{scene.title}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            ~{scene.estimatedDuration ? Math.round(scene.estimatedDuration) : "—"}s
          </span>
          <button
            onClick={() => onEdit(scene)}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-secondary rounded-lg"
          >
            <Edit3 className="w-3.5 h-3.5 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Table Content - 4 Columns */}
      <div className="grid grid-cols-12 gap-4 p-5">
        {/* Col 1: 画面类型 */}
        <div className="col-span-2 flex items-start gap-2">
          <div className="p-2 rounded-lg bg-purple/5 border border-purple/10 shrink-0 mt-0.5">
            <TypeIcon className="w-4 h-4 text-purple" />
          </div>
          <span className="text-xs font-medium text-foreground pt-1.5">
            {typeInfo.label}
          </span>
        </div>

        {/* Col 2: 口播脚本 */}
        <div className="col-span-5 space-y-1.5">
          <div className="flex items-center gap-1 mb-1">
            <Mic className="w-3 h-3 text-purple" />
            <span className="text-[11px] font-medium text-purple">口播脚本</span>
          </div>
          {voiceoverScripts.slice(0, expanded ? undefined : 3).map((line: string, i: number) => (
            <p key={i} className="text-[12px] text-muted-foreground leading-relaxed pl-4">
              <span className="text-purple/60 font-medium">脚本{i + 1}：</span>{line}
            </p>
          ))}
          {!expanded && voiceoverScripts.length > 3 && (
            <button
              onClick={() => setExpanded(true)}
              className="text-[11px] text-purple hover:text-purple-light pl-4"
            >
              展开剩余 {voiceoverScripts.length - 3} 条...
            </button>
          )}
        </div>

        {/* Col 3: 素材检索 */}
        <div className="col-span-3 space-y-1.5">
          <div className="flex items-center gap-1 mb-1">
            <Search className="w-3 h-3 text-purple" />
            <span className="text-[11px] font-medium text-purple">素材检索</span>
          </div>
          <div className="space-y-1 pl-4">
            {materialLines.slice(0, expanded ? undefined : 2).map((line: string, i: number) => (
              <p key={i} className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                {line}
              </p>
            ))}
            {!expanded && materialLines.length > 2 && (
              <button
                onClick={() => setExpanded(true)}
                className="text-[11px] text-purple hover:text-purple-light"
              >
                更多...
              </button>
            )}
          </div>
        </div>

        {/* Col 4: 画面描述 */}
        <div className="col-span-2 space-y-1.5">
          <div className="flex items-center gap-1 mb-1">
            <Eye className="w-3 h-3 text-purple" />
            <span className="text-[11px] font-medium text-purple">画面描述</span>
          </div>
          <p className={`text-[11px] text-muted-foreground leading-relaxed ${expanded ? "" : "line-clamp-4"}`}>
            {scene.visualDesc || "暂无描述"}
          </p>
        </div>
      </div>

      {/* Expand/Collapse Footer */}
      <div className="px-5 py-2 border-t border-border/50 flex items-center justify-center">
        {expanded ? (
          <button
            onClick={() => setExpanded(false)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-purple transition-colors"
          >
            收起详情
          </button>
        ) : (
          <button
            onClick={() => setExpanded(true)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-purple transition-colors"
          >
            查看完整内容
          </button>
        )}
      </div>
    </div>
  );
}
