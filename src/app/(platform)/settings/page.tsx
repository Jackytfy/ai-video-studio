"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Loader2 } from "lucide-react";

const PROVIDER_PRESETS: Record<string, { label: string; baseUrl: string; model: string }[]> = {
  openai: [
    { label: "MiMo Pro (小米 Token Plan 中国)", baseUrl: "https://token-plan-cn.xiaomimimo.com/v1", model: "mimo-v2.5-pro" },
    { label: "MiMo Pro (小米 Token Plan 新加坡)", baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1", model: "mimo-v2.5-pro" },
    { label: "MiMo Pro (小米 Token Plan 欧洲)", baseUrl: "https://token-plan-ams.xiaomimimo.com/v1", model: "mimo-v2.5-pro" },
    { label: "MiMo Pro (小米 按量付费)", baseUrl: "https://api.xiaomimimo.com/v1", model: "mimo-v2.5-pro" },
    { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
    { label: "Moonshot (Kimi)", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
    { label: "Zhipu (智谱)", baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash" },
    { label: "Qwen (通义千问)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-turbo" },
    { label: "自定义", baseUrl: "", model: "" },
  ],
};

export default function SettingsPage() {
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ["userSettings"],
    queryFn: async () => {
      const res = await fetch("/api/user/settings");
      if (!res.ok) throw new Error("获取设置失败");
      return res.json();
    },
  });

  const [form, setForm] = useState({
    name: "",
    aiProvider: "claude",
    aiModel: "claude-sonnet-4-20250514",
    aiBaseUrl: "",
    aiApiKey: "",
    ttsProvider: "edge-tts",
    ttsVoice: "zh-CN-YunxiNeural",
  });

  const [selectedPreset, setSelectedPreset] = useState("");

  useEffect(() => {
    if (settings) {
      setForm({
        name: settings.name || "",
        aiProvider: settings.aiProvider,
        aiModel: settings.aiModel,
        aiBaseUrl: settings.aiBaseUrl || "",
        aiApiKey: settings.aiApiKey || "",
        ttsProvider: settings.ttsProvider,
        ttsVoice: settings.ttsVoice,
      });
    }
  }, [settings]);

  const applyPreset = (presetLabel: string) => {
    const presets = PROVIDER_PRESETS[form.aiProvider] || [];
    const preset = presets.find((p) => p.label === presetLabel);
    if (preset && preset.baseUrl) {
      setForm((f) => ({ ...f, aiBaseUrl: preset.baseUrl, aiModel: preset.model }));
    }
    setSelectedPreset(presetLabel);
  };

  const mutation = useMutation({
    mutationFn: async (data: typeof form) => {
      const body = {
        ...data,
        aiBaseUrl: data.aiProvider === "openai" && data.aiBaseUrl ? data.aiBaseUrl : null,
        aiApiKey: data.aiProvider === "openai" && data.aiApiKey ? data.aiApiKey : null,
      };
      const res = await fetch("/api/user/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `保存失败 (${res.status})`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["userSettings"] });
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 animate-pulse space-y-4">
        <div className="h-8 bg-secondary rounded w-1/4" />
        <div className="h-64 bg-secondary rounded" />
      </div>
    );
  }

  const isCustomProvider = form.aiProvider === "openai";

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">设置</h1>

      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="font-semibold">基本信息</h2>
        <div className="space-y-2">
          <label className="text-sm font-medium">昵称</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          邮箱：{settings?.email}
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="font-semibold">AI 模型设置</h2>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">AI 提供商</label>
            <select
              value={form.aiProvider}
              onChange={(e) => {
                setForm({ ...form, aiProvider: e.target.value, aiBaseUrl: "", aiApiKey: "" });
                setSelectedPreset("");
              }}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="claude">Claude</option>
              <option value="openai">OpenAI 兼容 API</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">模型</label>
            <input
              value={form.aiModel}
              onChange={(e) => setForm({ ...form, aiModel: e.target.value })}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple"
            />
          </div>
        </div>

        {isCustomProvider && (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">快速选择</label>
              <select
                value={selectedPreset}
                onChange={(e) => applyPreset(e.target.value)}
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm"
              >
                <option value="">选择预设...</option>
                {(PROVIDER_PRESETS.openai || []).map((p) => (
                  <option key={p.label} value={p.label}>{p.label}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">API Base URL</label>
              <input
                value={form.aiBaseUrl}
                onChange={(e) => setForm({ ...form, aiBaseUrl: e.target.value })}
                placeholder="https://api.example.com/v1"
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple"
              />
              <p className="text-xs text-muted-foreground">
                OpenAI 兼容 API 的基础地址（不含 /chat/completions）
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">API Key</label>
              <input
                type="password"
                value={form.aiApiKey}
                onChange={(e) => setForm({ ...form, aiApiKey: e.target.value })}
                placeholder="sk-..."
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple"
              />
              <p className="text-xs text-muted-foreground">
                留空则使用环境变量中的 OPENAI_API_KEY
              </p>
            </div>
          </>
        )}
      </div>

      <div className="bg-card border border-border rounded-xl p-6 space-y-4">
        <h2 className="font-semibold">TTS 设置</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">TTS 提供商</label>
            <select
              value={form.ttsProvider}
              onChange={(e) => {
                const provider = e.target.value;
                const defaultVoice = provider === "mimo" ? "冰糖" : "zh-CN-YunxiNeural";
                setForm({ ...form, ttsProvider: provider, ttsVoice: defaultVoice });
              }}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm"
            >
              <option value="edge-tts">Edge TTS（免费）</option>
              <option value="mimo">MiMo TTS（小米）</option>
              <option value="azure">Azure TTS</option>
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">语音</label>
            <select
              value={form.ttsVoice}
              onChange={(e) => setForm({ ...form, ttsVoice: e.target.value })}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm"
            >
              {form.ttsProvider === "mimo" ? (
                <>
                  <optgroup label="中文">
                    <option value="冰糖">冰糖（女）</option>
                    <option value="茉莉">茉莉（女）</option>
                    <option value="苏打">苏打（男）</option>
                    <option value="白桦">白桦（男）</option>
                  </optgroup>
                  <optgroup label="English">
                    <option value="Mia">Mia (Female)</option>
                    <option value="Chloe">Chloe (Female)</option>
                    <option value="Milo">Milo (Male)</option>
                    <option value="Dean">Dean (Male)</option>
                  </optgroup>
                </>
              ) : (
                <>
                  <option value="zh-CN-YunxiNeural">云希（男）</option>
                  <option value="zh-CN-YunyangNeural">云扬（男）</option>
                  <option value="zh-CN-XiaoxiaoNeural">晓晓（女）</option>
                  <option value="zh-CN-XiaoyiNeural">晓依（女）</option>
                </>
              )}
            </select>
          </div>
        </div>
        {form.ttsProvider === "mimo" && (
          <p className="text-xs text-muted-foreground">
            MiMo TTS 使用小米 MiMo-V2.5-TTS 模型，需配置 MIMO_API_KEY 或在上方 AI 设置中填写 API Key。
            支持风格控制，在口播脚本前加风格标签如 (温柔)、(激动) 即可。
          </p>
        )}
      </div>

      <button
        onClick={() => mutation.mutate(form)}
        disabled={mutation.isPending}
        className="flex items-center gap-2 bg-purple hover:bg-purple-light text-white px-6 py-2.5 rounded-lg font-medium transition-colors disabled:opacity-50"
      >
        {mutation.isPending ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Save className="w-4 h-4" />
        )}
        {mutation.isPending ? "保存中..." : "保存设置"}
      </button>

      {mutation.isSuccess && (
        <p className="text-sm text-green-400">设置已保存</p>
      )}
      {mutation.isError && (
        <p className="text-sm text-destructive">保存失败，请重试</p>
      )}
    </div>
  );
}
