"use client";

import { useState } from "react";
import { Search, Loader2 } from "lucide-react";

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

interface MaterialSearchPanelProps {
  projectId: string;
  sceneId: string;
  defaultQuery?: string;
  onSelect: (material: Material) => void;
}

export function MaterialSearchPanel({
  projectId,
  sceneId,
  defaultQuery = "",
  onSelect,
}: MaterialSearchPanelProps) {
  const [query, setQuery] = useState(defaultQuery);
  const [results, setResults] = useState<Material[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchType, setSearchType] = useState<"video" | "image">("video");

  const handleSearch = async () => {
    if (!query.trim()) return;
    setIsSearching(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/materials/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, type: searchType }),
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
    try {
      await fetch(`/api/projects/${projectId}/materials/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId, material }),
      });
      onSelect(material);
    } catch (error) {
      console.error("Assign error:", error);
    }
  };

  return (
    <div className="space-y-4">
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
          onClick={handleSearch}
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
    </div>
  );
}
