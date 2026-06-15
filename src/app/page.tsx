"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Sparkles, Film, Wand2, Music, Download, ArrowRight } from "lucide-react";
import { useSession } from "next-auth/react";

export default function Home() {
  const { data: session, status } = useSession();
  const [mounted, setMounted] = useState(false);

  // Defer reading the session until the client mounts to keep the page
  // static-friendly and to avoid hydration mismatches.
  useEffect(() => {
    setMounted(true);
  }, []);

  const ctaHref = mounted && status === "authenticated" ? "/dashboard" : "/login";
  const ctaLabel = mounted && status === "authenticated" ? "进入工作台" : "立即开始";

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top nav */}
      <header className="w-full border-b border-border/40 backdrop-blur-sm bg-background/60 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple to-pink-500 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold">AI 视频创作平台</span>
          </div>
          <nav className="flex items-center gap-3">
            {mounted && status === "authenticated" ? (
              <Link
                href="/dashboard"
                className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition"
              >
                进入工作台
              </Link>
            ) : (
              <>
                <Link
                  href="/login"
                  className="text-sm text-muted-foreground hover:text-foreground transition px-3 py-2"
                >
                  登录
                </Link>
                <Link
                  href="/register"
                  className="text-sm px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition"
                >
                  注册
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1">
        <section className="max-w-6xl mx-auto px-6 pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 text-xs px-3 py-1 rounded-full border border-border bg-secondary/50 text-muted-foreground mb-6">
            <Sparkles className="w-3 h-3" />
            文字 → 分镜 → 视频，全自动流水线
          </div>
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
            让文字 <span className="bg-gradient-to-r from-purple to-pink-500 bg-clip-text text-transparent">穿越到影像</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
            粘贴一段文稿，AI 自动分析主题、生成配音脚本、检索匹配素材，
            合成带字幕的成片视频 — 几分钟即可完成原本需要数小时的剪辑工作。
          </p>
          <div className="mt-10 flex items-center justify-center gap-4">
            <Link
              href={ctaHref}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition text-sm font-medium"
            >
              {ctaLabel}
              <ArrowRight className="w-4 h-4" />
            </Link>
            <a
              href="#features"
              className="text-sm text-muted-foreground hover:text-foreground transition px-4 py-3"
            >
              了解能力 →
            </a>
          </div>
        </section>

        {/* Features */}
        <section id="features" className="max-w-6xl mx-auto px-6 py-16">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <Feature
              icon={<Wand2 className="w-5 h-5" />}
              title="AI 智能分镜"
              desc="基于文稿自动拆分场景，生成画面描述、口播文案、素材检索关键词。"
            />
            <Feature
              icon={<Film className="w-5 h-5" />}
              title="多源素材匹配"
              desc="B 站、Pexels、Pixabay 多平台检索实拍片段，自动按场景卡点。"
            />
            <Feature
              icon={<Music className="w-5 h-5" />}
              title="TTS + 字幕"
              desc="Edge TTS / MiMo 配音，自动生成逐句同步字幕，导出即可发布。"
            />
            <Feature
              icon={<Sparkles className="w-5 h-5" />}
              title="多模型路由"
              desc="Claude / OpenAI / MiMo 自动 fallback，按场景选择最合适的模型。"
            />
            <Feature
              icon={<Download className="w-5 h-5" />}
              title="一键导出"
              desc="16:9 / 9:16 / 1:1 多种画幅，渲染完成后直接在浏览器下载 MP4。"
            />
            <Feature
              icon={<Wand2 className="w-5 h-5" />}
              title="可视化编辑"
              desc="时间轴上拖拽片段裁剪、替换素材、调节 BGM 音量，所见即所得。"
            />
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-border/40">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between text-xs text-muted-foreground">
          <span>AI 视频创作平台</span>
          <span>文字 → 影像，让创作更轻</span>
        </div>
      </footer>
    </div>
  );
}

function Feature({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="border border-border rounded-xl p-6 bg-card hover:bg-card/80 transition">
      <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}
