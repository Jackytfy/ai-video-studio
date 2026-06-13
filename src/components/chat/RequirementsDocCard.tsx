"use client";

import { FileText, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

interface RequirementsDocData {
  summary: string;
  contentStyle: string;
  keyTopics: string[];
  entities: {
    people: string[];
    places: string[];
    events: string[];
    timePeriods: string[];
  };
  targetAudience?: string;
  toneAndStyle?: string;
  visualRequirements?: string[];
}

interface RequirementsDocCardProps {
  data: RequirementsDocData;
}

export function RequirementsDocCard({ data }: RequirementsDocCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-card border border-border rounded-xl p-5 max-w-lg space-y-4">
      <div className="flex items-center gap-2 text-purple">
        <FileText className="w-4 h-4" />
        <span className="font-semibold text-sm">需求文档</span>
      </div>

      <p className="text-sm text-muted-foreground">{data.summary}</p>

      <div className="flex flex-wrap gap-1.5">
        {data.keyTopics.map((topic) => (
          <span
            key={topic}
            className="bg-purple/10 text-purple text-xs px-2 py-0.5 rounded-full"
          >
            {topic}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        {data.entities.people.length > 0 && (
          <div>
            <span className="text-muted-foreground">人物：</span>
            <span>{data.entities.people.slice(0, 5).join("、")}</span>
          </div>
        )}
        {data.entities.places.length > 0 && (
          <div>
            <span className="text-muted-foreground">地点：</span>
            <span>{data.entities.places.slice(0, 5).join("、")}</span>
          </div>
        )}
        {data.entities.events.length > 0 && (
          <div>
            <span className="text-muted-foreground">事件：</span>
            <span>{data.entities.events.slice(0, 5).join("、")}</span>
          </div>
        )}
        {data.entities.timePeriods.length > 0 && (
          <div>
            <span className="text-muted-foreground">时代：</span>
            <span>{data.entities.timePeriods.join("、")}</span>
          </div>
        )}
      </div>

      {data.toneAndStyle && (
        <div className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">风格基调：</span>
          {data.toneAndStyle}
        </div>
      )}

      {data.visualRequirements && data.visualRequirements.length > 0 && (
        <div>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-purple hover:text-purple-light transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            画面要求
          </button>
          {expanded && (
            <ul className="mt-2 space-y-1 pl-4">
              {data.visualRequirements.map((req, i) => (
                <li key={i} className="text-xs text-muted-foreground list-disc">
                  {req}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="border-t border-border pt-2 text-xs text-muted-foreground">
        内容类型：{data.contentStyle}
      </div>
    </div>
  );
}
