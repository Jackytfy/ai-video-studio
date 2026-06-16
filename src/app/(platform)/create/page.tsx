"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { HeroSection } from "@/components/landing/HeroSection";
import { TextInputArea, MaterialRequirements } from "@/components/landing/TextInputArea";
import { StyleSelector } from "@/components/landing/StyleSelector";
import { ContentTags } from "@/components/landing/ContentTags";

export default function CreatePage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [voice, setVoice] = useState("yunxi");
  const [contentStyle, setContentStyle] = useState("knowledge");
  const [renderMode, setRenderMode] = useState("stock");

  const [statusText, setStatusText] = useState("");

  const handleSubmit = async (text: string, materialReqs?: MaterialRequirements) => {
    setIsLoading(true);
    try {
      // Step 1: Create project
      setStatusText("正在创建项目...");
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: text.slice(0, 30) + (text.length > 30 ? "..." : ""),
          sourceText: text,
          aspectRatio,
          voice,
          contentStyle,
          renderMode,
          materialRequirements: materialReqs,
        }),
      });

      if (!response.ok) throw new Error("创建失败");
      const project = await response.json();

      // Step 2: Auto-generate storyboard from text (no AI, uses exact user text)
      setStatusText("正在生成分镜...");
      const sbRes = await fetch(`/api/projects/${project.id}/quick-generate`, {
        method: "POST",
      });

      if (!sbRes.ok) throw new Error("分镜生成失败");

      // Step 3: Auto-redirect to storyboard page
      setStatusText("完成！跳转中...");
      router.push(`/projects/${project.id}/storyboard`);
    } catch (error) {
      console.error("Failed:", error);
      setIsLoading(false);
      setStatusText("");
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      <div className="fixed inset-0 bg-gradient-to-b from-purple/5 via-transparent to-transparent pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8 }}
        className="relative z-10 space-y-8 w-full max-w-3xl"
      >
        <HeroSection />

        <div className="space-y-4">
          <StyleSelector
            aspectRatio={aspectRatio}
            onAspectRatioChange={setAspectRatio}
            voice={voice}
            onVoiceChange={setVoice}
            renderMode={renderMode}
            onRenderModeChange={setRenderMode}
          />

          <TextInputArea onSubmit={handleSubmit} isLoading={isLoading} />

          {statusText && (
            <p className="text-center text-sm text-purple animate-pulse">{statusText}</p>
          )}

          <ContentTags selected={contentStyle} onSelect={setContentStyle} />
        </div>
      </motion.div>
    </div>
  );
}
