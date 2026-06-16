"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface StyleSelectorProps {
  aspectRatio: string;
  onAspectRatioChange: (value: string) => void;
  voice: string;
  onVoiceChange: (value: string) => void;
  renderMode: string;
  onRenderModeChange: (value: string) => void;
}

const ASPECT_RATIOS = [
  { value: "16:9", label: "横屏 16:9" },
  { value: "9:16", label: "竖屏 9:16" },
  { value: "1:1", label: "方形 1:1" },
];

const VOICES = [
  { value: "yunxi", label: "云希（男声）" },
  { value: "xiaoxiao", label: "晓晓（女声）" },
  { value: "yunjian", label: "云健（男声）" },
  { value: "xiaoyi", label: "晓艺（女声）" },
];

const RENDER_MODES = [
  { value: "stock", label: "影视素材" },
  { value: "ai_video", label: "AI 生成" },
];

export function StyleSelector({
  aspectRatio,
  onAspectRatioChange,
  voice,
  onVoiceChange,
  renderMode,
  onRenderModeChange,
}: StyleSelectorProps) {
  return (
    <div className="flex gap-3 flex-wrap justify-center">
      <Select
        value={aspectRatio}
        onValueChange={(v) => v && onAspectRatioChange(v)}
      >
        <SelectTrigger className="w-[140px] bg-secondary/50 border-border">
          <SelectValue placeholder="画面" />
        </SelectTrigger>
        <SelectContent>
          {ASPECT_RATIOS.map((ratio) => (
            <SelectItem key={ratio.value} value={ratio.value}>
              {ratio.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={voice}
        onValueChange={(v) => v && onVoiceChange(v)}
      >
        <SelectTrigger className="w-[140px] bg-secondary/50 border-border">
          <SelectValue placeholder="配音" />
        </SelectTrigger>
        <SelectContent>
          {VOICES.map((v) => (
            <SelectItem key={v.value} value={v.value}>
              {v.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={renderMode}
        onValueChange={(v) => v && onRenderModeChange(v)}
      >
        <SelectTrigger className="w-[140px] bg-secondary/50 border-border">
          <SelectValue placeholder="场景" />
        </SelectTrigger>
        <SelectContent>
          {RENDER_MODES.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
