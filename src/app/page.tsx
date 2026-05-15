"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { HeroSection } from "@/components/landing/HeroSection";
import { TextInputArea } from "@/components/landing/TextInputArea";
import { StyleSelector } from "@/components/landing/StyleSelector";
import { ContentTags } from "@/components/landing/ContentTags";

export default function Home() {
  const router = useRouter();
  const { status } = useSession();
  const [isLoading, setIsLoading] = useState(false);
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [voice, setVoice] = useState("yunxi");
  const [contentStyle, setContentStyle] = useState("knowledge");

  const handleSubmit = async (text: string) => {
    if (status !== "authenticated") {
      router.push("/login");
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: text.slice(0, 30) + (text.length > 30 ? "..." : ""),
          sourceText: text,
          aspectRatio,
          voice,
          contentStyle,
        }),
      });

      if (response.ok) {
        const project = await response.json();
        router.push(`/projects/${project.id}/chat`);
      }
    } catch (error) {
      console.error("Failed to create project:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-12">
      {/* Background gradient effect */}
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
          />

          <TextInputArea onSubmit={handleSubmit} isLoading={isLoading} />

          <ContentTags selected={contentStyle} onSelect={setContentStyle} />
        </div>
      </motion.div>
    </div>
  );
}
