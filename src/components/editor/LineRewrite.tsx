"use client";

import { useState, useCallback } from "react";
import { Sparkles, Check, X, RotateCcw, Loader2 } from "lucide-react";

interface LineRewriteProps {
  text: string;
  lineIndex: number;
  onRewrite: (lineIndex: number, newText: string) => void;
  onAIRequest?: (fullText: string, lineIndex: number, instruction?: string) => Promise<string>;
}

export function LineRewrite({
  text,
  lineIndex,
  onRewrite,
  onAIRequest,
}: LineRewriteProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(text);
  const [isAIWriting, setIsAIWriting] = useState(false);
  const [showAIInput, setShowAIInput] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");

  const handleSave = useCallback(() => {
    if (editText.trim() && editText !== text) {
      onRewrite(lineIndex, editText.trim());
    }
    setIsEditing(false);
  }, [editText, text, lineIndex, onRewrite]);

  const handleCancel = useCallback(() => {
    setEditText(text);
    setIsEditing(false);
    setShowAIInput(false);
    setAiInstruction("");
  }, [text]);

  const handleAIRewrite = useCallback(async () => {
    if (!onAIRequest) return;
    setIsAIWriting(true);
    try {
      const result = await onAIRequest(text, lineIndex, aiInstruction || undefined);
      setEditText(result);
      setShowAIInput(false);
      setAiInstruction("");
    } catch (err) {
      console.error("AI rewrite failed:", err);
    } finally {
      setIsAIWriting(false);
    }
  }, [text, lineIndex, aiInstruction, onAIRequest]);

  if (isEditing) {
    return (
      <div className="space-y-2">
        <textarea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          className="w-full bg-secondary border border-purple/40 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple resize-none"
          rows={3}
          autoFocus
        />

        {/* AI instruction input */}
        {showAIInput && (
          <div className="flex gap-2">
            <input
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAIRewrite()}
              placeholder="AI 重写指令，如：更口语化、更正式、加入比喻..."
              className="flex-1 bg-secondary border border-border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple"
              autoFocus
            />
            <button
              onClick={handleAIRewrite}
              disabled={isAIWriting}
              className="bg-purple hover:bg-purple-light text-white px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              {isAIWriting ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              重写
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            className="flex items-center gap-1 text-xs text-green-500 hover:text-green-400 transition-colors"
          >
            <Check className="w-3 h-3" />
            保存
          </button>
          <button
            onClick={handleCancel}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-3 h-3" />
            取消
          </button>
          <button
            onClick={() => setEditText(text)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            还原
          </button>
          {onAIRequest && !showAIInput && (
            <button
              onClick={() => setShowAIInput(true)}
              className="flex items-center gap-1 text-xs text-purple hover:text-purple-light transition-colors ml-auto"
            >
              <Sparkles className="w-3 h-3" />
              AI 重写
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className="group relative cursor-pointer"
      onDoubleClick={() => setIsEditing(true)}
    >
      <p className="text-sm text-foreground whitespace-pre-wrap pr-6">
        {text}
      </p>
      <button
        onClick={() => setIsEditing(true)}
        className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-secondary"
        title="编辑此行"
      >
        <Sparkles className="w-3 h-3 text-purple" />
      </button>
    </div>
  );
}

/**
 * Container component that manages line-level rewriting for a full voiceover text.
 */
interface VoiceoverRewritePanelProps {
  voiceoverText: string;
  onUpdate: (newText: string) => void;
  onAIRequest?: (fullText: string, lineIndex: number, instruction?: string) => Promise<string>;
}

export function VoiceoverRewritePanel({
  voiceoverText,
  onUpdate,
  onAIRequest,
}: VoiceoverRewritePanelProps) {
  const lines = voiceoverText.split("\n").filter((l) => l.trim());

  const handleLineRewrite = useCallback(
    (lineIndex: number, newText: string) => {
      const updatedLines = [...lines];
      updatedLines[lineIndex] = newText;
      onUpdate(updatedLines.join("\n"));
    },
    [lines, onUpdate]
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">口播脚本</span>
        <span className="text-[10px] text-muted-foreground">双击行可编辑</span>
      </div>
      {lines.map((line, i) => (
        <div key={i} className="relative pl-6">
          <span className="absolute left-0 top-0 text-[10px] text-muted-foreground font-mono">
            {String(i + 1).padStart(2, "0")}
          </span>
          <LineRewrite
            text={line}
            lineIndex={i}
            onRewrite={handleLineRewrite}
            onAIRequest={onAIRequest}
          />
        </div>
      ))}
    </div>
  );
}
