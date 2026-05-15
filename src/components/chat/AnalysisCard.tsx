"use client";

import { Lightbulb, MapPin, Users, Calendar, Tag } from "lucide-react";

interface AnalysisData {
  summary: string;
  entities: {
    people: string[];
    places: string[];
    events: string[];
    timePeriods: string[];
  };
  contentCategory: string;
  keyTopics: string[];
  suggestedPlan: "A" | "B";
  planReason: string;
  sceneCount: number;
  estimatedDuration: number;
}

interface AnalysisCardProps {
  analysis: AnalysisData;
  onSelectPlan?: () => void;
}

export function AnalysisCard({ analysis, onSelectPlan }: AnalysisCardProps) {
  return (
    <div className="bg-card border border-border rounded-xl p-5 max-w-lg space-y-4">
      <div className="flex items-center gap-2 text-purple">
        <Lightbulb className="w-4 h-4" />
        <span className="font-semibold text-sm">AI 分析结果</span>
      </div>

      <p className="text-sm text-muted-foreground">{analysis.summary}</p>

      <div className="grid grid-cols-2 gap-3 text-xs">
        {analysis.entities.people.length > 0 && (
          <div className="flex items-start gap-2">
            <Users className="w-3 h-3 mt-0.5 text-muted-foreground" />
            <div>
              <span className="text-muted-foreground">人物：</span>
              <span>{analysis.entities.people.join("、")}</span>
            </div>
          </div>
        )}
        {analysis.entities.places.length > 0 && (
          <div className="flex items-start gap-2">
            <MapPin className="w-3 h-3 mt-0.5 text-muted-foreground" />
            <div>
              <span className="text-muted-foreground">地点：</span>
              <span>{analysis.entities.places.join("、")}</span>
            </div>
          </div>
        )}
        {analysis.entities.timePeriods.length > 0 && (
          <div className="flex items-start gap-2">
            <Calendar className="w-3 h-3 mt-0.5 text-muted-foreground" />
            <div>
              <span className="text-muted-foreground">时代：</span>
              <span>{analysis.entities.timePeriods.join("、")}</span>
            </div>
          </div>
        )}
        <div className="flex items-start gap-2">
          <Tag className="w-3 h-3 mt-0.5 text-muted-foreground" />
          <div>
            <span className="text-muted-foreground">分类：</span>
            <span>{analysis.contentCategory}</span>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {analysis.keyTopics.map((topic) => (
          <span
            key={topic}
            className="bg-purple/10 text-purple text-xs px-2 py-0.5 rounded-full"
          >
            {topic}
          </span>
        ))}
      </div>

      <div className="border-t border-border pt-3 flex items-center justify-between text-xs">
        <div className="flex gap-4 text-muted-foreground">
          <span>建议 {analysis.sceneCount} 个场景</span>
          <span>约 {Math.round(analysis.estimatedDuration)} 秒</span>
        </div>
        <span className="text-purple font-medium">
          推荐方案 {analysis.suggestedPlan}
        </span>
      </div>

      <p className="text-xs text-muted-foreground italic">
        {analysis.planReason}
      </p>

      {onSelectPlan && (
        <button
          onClick={onSelectPlan}
          className="w-full bg-purple hover:bg-purple-light text-white py-2 rounded-lg text-sm font-medium transition-colors"
        >
          选择方案并生成分镜
        </button>
      )}
    </div>
  );
}
