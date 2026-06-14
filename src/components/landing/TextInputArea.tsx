"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Upload, Sparkles, ChevronDown, ChevronUp, Film } from "lucide-react";

export interface MaterialRequirements {
  contentSummary?: string;
  referenceStyle?: string;
  requiredSources?: string[];
  preferredSources?: string[];
  materialTypes?: string[];
  properNouns?: string[];
  landmarkScenes?: string[];
  stylePreference?: string;
  timeLimit?: string;
  regionLimit?: string;
  avoidKeywords?: string[];
}

interface TextInputAreaProps {
  onSubmit: (text: string, materialReqs?: MaterialRequirements) => void;
  isLoading?: boolean;
}

const MAX_CHARS = 10000;

export function TextInputArea({ onSubmit, isLoading }: TextInputAreaProps) {
  const [text, setText] = useState("");
  const [activeTab, setActiveTab] = useState<"input" | "upload">("input");
  const [showMaterialReqs, setShowMaterialReqs] = useState(false);

  // Material requirements state
  const [contentSummary, setContentSummary] = useState("");
  const [referenceStyle, setReferenceStyle] = useState("");
  const [requiredSources, setRequiredSources] = useState("");
  const [preferredSources, setPreferredSources] = useState("");
  const [properNouns, setProperNouns] = useState("");
  const [landmarkScenes, setLandmarkScenes] = useState("");
  const [stylePreference, setStylePreference] = useState("");
  const [regionLimit, setRegionLimit] = useState("");
  const [avoidKeywords, setAvoidKeywords] = useState("");

  const charCount = text.length;
  const canSubmit = text.trim().length > 0 && charCount <= MAX_CHARS;

  const handleSubmit = () => {
    if (canSubmit) {
      // Build material requirements only if any field is filled
      const hasMaterialReqs = contentSummary || referenceStyle || requiredSources || preferredSources || properNouns || landmarkScenes || stylePreference || regionLimit || avoidKeywords;
      const materialReqs: MaterialRequirements | undefined = hasMaterialReqs ? {
        contentSummary: contentSummary || undefined,
        referenceStyle: referenceStyle || undefined,
        requiredSources: requiredSources ? requiredSources.split(/[,，、]/).map(s => s.trim()).filter(Boolean) : undefined,
        preferredSources: preferredSources ? preferredSources.split(/[,，、]/).map(s => s.trim()).filter(Boolean) : undefined,
        materialTypes: ["影视剧片段", "历史纪录片", "古籍影像", "古代绘画"],
        properNouns: properNouns ? properNouns.split(/[,，、]/).map(s => s.trim()).filter(Boolean) : undefined,
        landmarkScenes: landmarkScenes ? landmarkScenes.split(/[,，、]/).map(s => s.trim()).filter(Boolean) : undefined,
        stylePreference: stylePreference || undefined,
        regionLimit: regionLimit || undefined,
        avoidKeywords: avoidKeywords ? avoidKeywords.split(/[,，、]/).map(s => s.trim()).filter(Boolean) : undefined,
      } : undefined;
      onSubmit(text, materialReqs);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      {/* Tabs */}
      <div className="flex gap-2">
        <Button
          variant={activeTab === "input" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("input")}
          className="text-sm"
        >
          输入文案
        </Button>
        <Button
          variant={activeTab === "upload" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("upload")}
          className="text-sm"
        >
          <Upload className="w-4 h-4 mr-1" />
          上传口播
        </Button>
      </div>

      {/* Input Area */}
      <div className="relative">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="输入/粘贴视频文稿，AI即为你生成精彩视频"
          className="min-h-[120px] bg-secondary/50 border-border resize-none pr-24"
          maxLength={MAX_CHARS}
        />
        <div className="absolute bottom-3 right-3 text-sm text-muted-foreground">
          {charCount} / {MAX_CHARS}
        </div>
      </div>

      {/* Material Requirements Toggle */}
      <button
        type="button"
        onClick={() => setShowMaterialReqs(!showMaterialReqs)}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <Film className="w-4 h-4" />
        <span>素材需求（可选）</span>
        {showMaterialReqs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      {/* Material Requirements Panel */}
      {showMaterialReqs && (
        <div className="space-y-3 p-4 rounded-lg bg-secondary/30 border border-border">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">内容摘要（帮助AI理解核心主题）</label>
            <Input
              value={contentSummary}
              onChange={(e) => setContentSummary(e.target.value)}
              placeholder="如：从清宫剧衰落与明史剧复兴现象切入，深度剖析年轻人审美转向"
              className="bg-secondary/50 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">参考风格</label>
            <Input
              value={referenceStyle}
              onChange={(e) => setReferenceStyle(e.target.value)}
              placeholder="如：B站历史区UP主解说风格，节奏紧凑、观点鲜明"
              className="bg-secondary/50 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">必须使用的影视/纪录片（逗号分隔）</label>
            <Input
              value={requiredSources}
              onChange={(e) => setRequiredSources(e.target.value)}
              placeholder="如：甄嬛传，大明王朝1566"
              className="bg-secondary/50 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">推荐素材来源（逗号分隔）</label>
            <Input
              value={preferredSources}
              onChange={(e) => setPreferredSources(e.target.value)}
              placeholder="如：康熙王朝，中国通史"
              className="bg-secondary/50 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">必须出现的人物/地名（逗号分隔）</label>
            <Input
              value={properNouns}
              onChange={(e) => setProperNouns(e.target.value)}
              placeholder="如：朱元璋，海瑞，故宫"
              className="bg-secondary/50 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">标志性场景（逗号分隔）</label>
            <Input
              value={landmarkScenes}
              onChange={(e) => setLandmarkScenes(e.target.value)}
              placeholder="如：紫禁城太和殿，古代朝堂"
              className="bg-secondary/50 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">画面风格偏好</label>
            <Input
              value={stylePreference}
              onChange={(e) => setStylePreference(e.target.value)}
              placeholder="如：历史厚重感，色调沉稳，人物特写"
              className="bg-secondary/50 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">地域限定</label>
            <Input
              value={regionLimit}
              onChange={(e) => setRegionLimit(e.target.value)}
              placeholder="如：中国古代场景，避免现代城市"
              className="bg-secondary/50 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">避免出现的素材关键词（逗号分隔）</label>
            <Input
              value={avoidKeywords}
              onChange={(e) => setAvoidKeywords(e.target.value)}
              placeholder="如：现代城市，综艺，游戏"
              className="bg-secondary/50 text-sm"
            />
          </div>
        </div>
      )}

      {/* Submit Button */}
      <div className="flex justify-end">
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || isLoading}
          className="bg-purple hover:bg-purple-light text-white px-6"
        >
          <Sparkles className="w-4 h-4 mr-2" />
          {isLoading ? "分析中..." : "创作"}
        </Button>
      </div>
    </div>
  );
}
