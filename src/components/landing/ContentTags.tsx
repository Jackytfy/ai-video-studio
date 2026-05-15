"use client";

import { Badge } from "@/components/ui/badge";

interface ContentTagsProps {
  selected: string;
  onSelect: (style: string) => void;
}

const CONTENT_STYLES = [
  { value: "knowledge", label: "知识科普类短视频", icon: "📚" },
  { value: "culture", label: "历史文化类视频", icon: "🏺" },
  { value: "classic", label: "经典历史解读视频", icon: "📜" },
];

export function ContentTags({ selected, onSelect }: ContentTagsProps) {
  return (
    <div className="flex gap-2 flex-wrap justify-center">
      {CONTENT_STYLES.map((style) => (
        <Badge
          key={style.value}
          variant={selected === style.value ? "default" : "secondary"}
          className={`cursor-pointer transition-colors ${
            selected === style.value
              ? "bg-purple text-white"
              : "bg-secondary/50 hover:bg-secondary"
          }`}
          onClick={() => onSelect(style.value)}
        >
          {style.icon} {style.label}
        </Badge>
      ))}
    </div>
  );
}
