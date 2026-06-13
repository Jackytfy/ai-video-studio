"use client";

import { useState, useEffect } from "react";
import { Search, Loader2, Upload, RefreshCw } from "lucide-react";

interface Material {
  externalId: string;
  type: string;
  source: string;
  fileUrl: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
}

interface SceneContext {
  sceneId: string;
  sceneNumber: number;
  title?: string;
  voiceoverText?: string;
  visualDesc?: string;
  materialQuery?: string;
  productionMeta?: string | null;
}

interface MaterialSearchPanelProps {
  projectId: string;
  sceneContext?: SceneContext | null;
  defaultQuery?: string;
  onSelect: (material: Material) => void;
  onUploadOwn?: () => void;
}

export function MaterialSearchPanel({
  projectId,
  sceneContext,
  defaultQuery = "",
  onSelect,
  onUploadOwn,
}: MaterialSearchPanelProps) {
  // Auto-derive query from scene context
  const derivedQuery = (() => {
    if (!sceneContext) return defaultQuery;

    // Priority: materialQuery > visualDesc keywords > voiceoverText keywords
    if (sceneContext.materialQuery) {
      return sceneContext.materialQuery;
    }

    // Extract concrete keywords from visualDesc
    if (sceneContext.visualDesc) {
      const words = sceneContext.visualDesc.match(/[\u4e00-\u9fff]{2,8}/g) || [];
      const abstractWords = new Set([
        "画面", "描述", "展现", "展示", "呈现", "表现", "体现", "反映",
        "风格", "色调", "氛围", "镜头", "光影", "构图", "采用", "运用",
        "使用", "适合", "需要", "可以", "强烈", "突出", "营造",
      ]);
      const concrete = words.filter((w) => !abstractWords.has(w));
      if (concrete.length > 0) {
        return [...new Set(concrete)].slice(0, 4).join(" ");
      }
    }

    // Fallback: extract from voiceover
    if (sceneContext.voiceoverText) {
      const words = sceneContext.voiceoverText.match(/[\u4e00-\u9fff]{2,6}/g) || [];
      const stopWords = new Set(["然后", "为啥", "为什么", "不是", "今天", "肯定", "听过", "真实", "发生", "所有", "必须", "几乎"]);
      const filtered = words.filter((w) => !stopWords.has(w)).slice(0, 4);
      return filtered.join(" ") || "";
    }

    return defaultQuery;
  })();

  const [query, setQuery] = useState(derivedQuery);
  const [results, setResults] = useState<Material[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchType, setSearchType] = useState<"video" | "image">("video");

  // Auto-search when scene context changes
  useEffect(() => {
    if (derivedQuery && derivedQuery !== query) {
      setQuery(derivedQuery);
    }
  }, [derivedQuery]);

  // Auto-trigger search when query is derived from scene context
  useEffect(() => {
    if (derivedQuery && derivedQuery.length > 0) {
      handleSearch(derivedQuery);
    }
  }, [derivedQuery]);

  const handleSearch = async (searchQuery?: string) => {
    const q = searchQuery || query;
    if (!q.trim()) return;
    setIsSearching(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/materials/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: q,
          type: searchType,
          sceneId: sceneContext?.sceneId,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setResults(data.results);
      }
    } catch (error) {
      console.error("Search error:", error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelect = async (material: Material) => {
    if (!sceneContext?.sceneId) return;
    try {
      await fetch(`/api/projects/${projectId}/materials/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId: sceneContext.sceneId, material }),
      });
      onSelect(material);
    } catch (error) {
      console.error("Assign error:", error);
    }
  };

  return (
    <div className="space-y-4">
      {/* Scene context header */}
      {sceneContext && (
        <div className="bg-secondary rounded-lg p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-purple">
              分镜{String(sceneContext.sceneNumber).padStart(2, "0")}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {sceneContext.title}
            </span>
          </div>
          {sceneContext.visualDesc && (
            <p className="text-[11px] text-muted-foreground line-clamp-2">
              {sceneContext.visualDesc}
            </p>
          )}
        </div>
      )}

      {/* Search input */}
      <div className="flex gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="搜索素材关键词..."
            className="w-full bg-secondary border border-border rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple"
          />
        </div>
        <select
          value={searchType}
          onChange={(e) => setSearchType(e.target.value as "video" | "image")}
          className="bg-secondary border border-border rounded-lg px-3 py-2 text-sm"
        >
          <option value="video">视频</option>
          <option value="image">图片</option>
        </select>
        <button
          onClick={() => handleSearch()}
          disabled={isSearching || !query.trim()}
          className="bg-purple hover:bg-purple-light text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          {isSearching ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            "搜索"
          )}
        </button>
      </div>

      {/* Results */}
      {results.length > 0 && (
        <div className="grid grid-cols-3 gap-3 max-h-64 overflow-y-auto">
          {results.map((item) => (
            <button
              key={item.externalId}
              onClick={() => handleSelect(item)}
              className="group relative rounded-lg overflow-hidden border border-border hover:border-purple transition-colors"
            >
              {item.thumbnailUrl ? (
                <img
                  src={item.thumbnailUrl}
                  alt=""
                  className="w-full h-24 object-cover"
                />
              ) : (
                <div className="w-full h-24 bg-secondary flex items-center justify-center text-muted-foreground text-xs">
                  {item.type}
                </div>
              )}
              <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                <span className="text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                  选择
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Action buttons: Re-match / Use own material */}
      <div className="flex gap-2">
        <button
          onClick={() => handleSearch()}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground hover:border-purple/50 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          重配画面
        </button>
        {onUploadOwn && (
          <button
            onClick={onUploadOwn}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-border rounded-lg text-xs text-muted-foreground hover:text-foreground hover:border-purple/50 transition-colors"
          >
            <Upload className="w-3 h-3" />
            使用我的素材
          </button>
        )}
      </div>
    </div>
  );
}
