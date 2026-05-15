"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Sparkles } from "lucide-react";

interface TextInputAreaProps {
  onSubmit: (text: string) => void;
  isLoading?: boolean;
}

const MAX_CHARS = 10000;

export function TextInputArea({ onSubmit, isLoading }: TextInputAreaProps) {
  const [text, setText] = useState("");
  const [activeTab, setActiveTab] = useState<"input" | "upload">("input");

  const charCount = text.length;
  const canSubmit = text.trim().length > 0 && charCount <= MAX_CHARS;

  const handleSubmit = () => {
    if (canSubmit) {
      onSubmit(text);
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
