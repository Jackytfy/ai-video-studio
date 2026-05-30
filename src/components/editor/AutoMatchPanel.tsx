"use client";

import { useState } from "react";
import {
  Wand2,
  Loader2,
  Check,
  RefreshCw,
  Film,
  Mic,
  Music,
} from "lucide-react";

interface MatchResult {
  sceneId: string;
  sceneNumber: number;
  sceneTitle: string;
  voiceoverText: string;
  suggestedMaterial: string;
  suggestedMood: string;
  keywords: string[];
}

interface AutoMatchPanelProps {
  projectId: string;
  scriptContent: string;
  onApplyMatches: () => void;
}

export function AutoMatchPanel({
  projectId,
  scriptContent,
  onApplyMatches,
}: AutoMatchPanelProps) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [matches, setMatches] = useState<MatchResult[]>([]);
  const [analysis, setAnalysis] = useState<{
    title: string;
    totalDuration: number;
    mood: string;
    genre: string;
    matches: MatchResult[];
  } | null>(null);

  const analyzeScript = async () => {
    setIsAnalyzing(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/auto-match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: scriptContent }),
      });

      if (res.ok) {
        const data = await res.json();
        setAnalysis(data);
        setMatches(data.matches);
      }
    } catch {
    } finally {
      setIsAnalyzing(false);
    }
  };

  const applyMatches = async () => {
    setIsApplying(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/auto-match/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matches }),
      });

      if (res.ok) {
        onApplyMatches();
      }
    } catch {
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Wand2 className="w-4 h-4 text-purple" />
          <span className="text-sm font-medium">AI 智能匹配</span>
        </div>
        {analysis && (
          <button
            onClick={analyzeScript}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
            重新分析
          </button>
        )}
      </div>

      <div className="p-4 space-y-4">
        {!analysis && (
          <div className="text-center py-8">
            <Wand2 className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground mb-4">
              AI 将分析文案内容，自动匹配适合的视频素材、配音风格和背景音乐
            </p>
            <button
              onClick={analyzeScript}
              disabled={isAnalyzing || !scriptContent}
              className="flex items-center gap-2 px-6 py-2.5 bg-purple hover:bg-purple-light text-white rounded-lg text-sm font-medium transition-colors mx-auto disabled:opacity-50"
            >
              {isAnalyzing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Wand2 className="w-4 h-4" />
              )}
              {isAnalyzing ? "分析中..." : "开始智能分析"}
            </button>
          </div>
        )}

        {analysis && (
          <>
            {/* Analysis summary */}
            <div className="bg-secondary rounded-lg p-4">
              <h3 className="text-sm font-medium mb-2">{analysis.title}</h3>
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div className="flex items-center gap-2">
                  <Film className="w-3.5 h-3.5 text-purple" />
                  <span className="text-muted-foreground">
                    {matches.length} 个场景
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Mic className="w-3.5 h-3.5 text-purple" />
                  <span className="text-muted-foreground">
                    ~{Math.round(analysis.totalDuration)}s
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Music className="w-3.5 h-3.5 text-purple" />
                  <span className="text-muted-foreground">
                    {analysis.mood} · {analysis.genre}
                  </span>
                </div>
              </div>
            </div>

            {/* Match results */}
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">场景匹配结果</p>
              {matches.map((match) => (
                <div
                  key={match.sceneId}
                  className="bg-secondary rounded-lg p-3 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-purple">
                      场景 {match.sceneNumber}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {match.sceneTitle}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {match.voiceoverText}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {match.keywords.map((kw, i) => (
                      <span
                        key={i}
                        className="text-[10px] px-1.5 py-0.5 bg-purple/10 text-purple rounded"
                      >
                        {kw}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-4 text-[11px]">
                    <span className="text-muted-foreground">
                      素材: {match.suggestedMaterial}
                    </span>
                    <span className="text-muted-foreground">
                      情绪: {match.suggestedMood}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Apply button */}
            <button
              onClick={applyMatches}
              disabled={isApplying}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-purple hover:bg-purple-light text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
            >
              {isApplying ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {isApplying ? "应用中..." : "应用所有匹配"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
