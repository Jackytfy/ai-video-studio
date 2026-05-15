"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnalysisCard } from "@/components/chat/AnalysisCard";
import { PlanSelector } from "@/components/chat/PlanSelector";
import { StoryboardCard } from "@/components/chat/StoryboardCard";

interface Message {
  id: string;
  role: string;
  content: string;
  messageType: string;
  metadata: string | null;
  createdAt: string;
}

export default function ChatPage() {
  const params = useParams();
  const projectId = params.id as string;
  const queryClient = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [input, setInput] = useState("");
  const [streamingText, setStreamingText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const { data: messages = [] } = useQuery<Message[]>({
    queryKey: ["messages", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/chat`);
      if (!res.ok) throw new Error("获取消息失败");
      return res.json();
    },
  });

  const { data: project } = useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}`);
      if (!res.ok) throw new Error("获取项目失败");
      return res.json();
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const userMessage = input;
    setInput("");
    setIsStreaming(true);
    setStreamingText("");

    try {
      const res = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage }),
      });

      if (!res.ok || !res.body) {
        throw new Error("发送失败");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.chunk) {
                fullText += data.chunk;
                setStreamingText(fullText);
              }
              if (data.done) {
                setStreamingText("");
              }
            } catch {}
          }
        }
      }

      queryClient.invalidateQueries({ queryKey: ["messages", projectId] });
    } catch (error) {
      console.error("Chat error:", error);
    } finally {
      setIsStreaming(false);
      setStreamingText("");
    }
  };

  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/analyze`, {
        method: "POST",
      });

      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["messages", projectId] });
        queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      }
    } catch (error) {
      console.error("Analysis error:", error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSelectPlan = async (plan: "A" | "B") => {
    setIsGenerating(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/storyboard/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan, sceneCount: 10 }),
      });

      if (res.ok) {
        queryClient.invalidateQueries({ queryKey: ["messages", projectId] });
        queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      }
    } catch (error) {
      console.error("Storyboard generation error:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const renderMessage = (msg: Message) => {
    if (msg.messageType === "ANALYSIS" && msg.metadata) {
      const meta = typeof msg.metadata === "string" ? JSON.parse(msg.metadata) : msg.metadata;
      return (
        <AnalysisCard
          key={msg.id}
          analysis={meta.analysis}
        />
      );
    }

    if (msg.messageType === "STORYBOARD_CARD" && msg.metadata) {
      const meta = typeof msg.metadata === "string" ? JSON.parse(msg.metadata) : msg.metadata;
      return (
        <StoryboardCard
          key={msg.id}
          projectId={projectId}
          totalScenes={meta.totalScenes}
          totalDuration={meta.totalDuration}
        />
      );
    }

    return (
      <div
        key={msg.id}
        className={`flex ${msg.role === "USER" ? "justify-end" : "justify-start"}`}
      >
        <div
          className={`max-w-[70%] rounded-lg px-4 py-2 text-sm whitespace-pre-wrap ${
            msg.role === "USER"
              ? "bg-purple text-white"
              : "bg-secondary text-foreground"
          }`}
        >
          {msg.content}
        </div>
      </div>
    );
  };

  const showAnalyzeButton =
    project?.status === "DRAFT" ||
    project?.status === "FAILED";

  const showPlanSelector =
    project?.status === "DRAFT" &&
    project?.aiAnalysis &&
    !messages.some((m: Message) => m.messageType === "STORYBOARD_CARD");

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-muted-foreground py-12 space-y-4">
            <p className="text-lg">开始你的视频创作之旅</p>
            <p className="text-sm">
              输入你的想法，AI 将帮助你分析内容并生成视频分镜
            </p>
          </div>
        )}

        {messages.map(renderMessage)}

        {showAnalyzeButton && !isAnalyzing && (
          <div className="flex justify-center">
            <button
              onClick={handleAnalyze}
              className="bg-purple hover:bg-purple-light text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
            >
              开始 AI 分析
            </button>
          </div>
        )}

        {isAnalyzing && (
          <div className="flex justify-center">
            <div className="bg-secondary rounded-lg px-6 py-3 text-sm">
              <span className="animate-pulse">AI 正在分析文稿内容...</span>
            </div>
          </div>
        )}

        {showPlanSelector && project?.aiAnalysis && (
          <div className="flex justify-center">
            <PlanSelector
              suggestedPlan={
                (typeof project.aiAnalysis === "string"
                  ? JSON.parse(project.aiAnalysis)
                  : project.aiAnalysis
                ).suggestedPlan as "A" | "B"
              }
              onSelect={handleSelectPlan}
              isLoading={isGenerating}
            />
          </div>
        )}

        {isGenerating && (
          <div className="flex justify-center">
            <div className="bg-secondary rounded-lg px-6 py-3 text-sm">
              <span className="animate-pulse">AI 正在生成分镜脚本...</span>
            </div>
          </div>
        )}

        {streamingText && (
          <div className="flex justify-start">
            <div className="bg-secondary rounded-lg px-4 py-2 text-sm max-w-[70%] whitespace-pre-wrap">
              {streamingText}
              <span className="animate-pulse ml-0.5">|</span>
            </div>
          </div>
        )}

        {isStreaming && !streamingText && (
          <div className="flex justify-start">
            <div className="bg-secondary rounded-lg px-4 py-2">
              <span className="animate-pulse text-sm">AI 正在思考...</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-border p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder="输入你的想法..."
            disabled={isStreaming}
            className="flex-1 bg-secondary border border-border rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="bg-purple hover:bg-purple-light text-white px-6 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
