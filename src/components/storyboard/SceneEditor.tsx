"use client";

import { useState } from "react";
import { X } from "lucide-react";

interface Scene {
  id: string;
  sceneNumber: number;
  title: string | null;
  sceneType: string;
  voiceoverText: string;
  visualDesc: string;
  materialQuery: string;
  wordCount: number | null;
  estimatedDuration: number | null;
}

interface SceneEditorProps {
  scene: Scene;
  onSave: (sceneId: string, data: Partial<Scene>) => void;
  onClose: () => void;
  isSaving?: boolean;
}

export function SceneEditor({ scene, onSave, onClose, isSaving }: SceneEditorProps) {
  const [title, setTitle] = useState(scene.title || "");
  const [voiceoverText, setVoiceoverText] = useState(scene.voiceoverText);
  const [visualDesc, setVisualDesc] = useState(scene.visualDesc);
  const [materialQuery, setMaterialQuery] = useState(scene.materialQuery);
  const [sceneType, setSceneType] = useState(scene.sceneType);

  const handleSave = () => {
    onSave(scene.id, {
      title: title || null,
      voiceoverText,
      visualDesc,
      materialQuery,
      sceneType,
      wordCount: voiceoverText.length,
      estimatedDuration: voiceoverText.length / 4,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto m-4">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <h2 className="font-semibold">编辑场景 {scene.sceneNumber}</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-secondary rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">场景标题</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="场景标题"
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">画面类型</label>
              <select
                value={sceneType}
                onChange={(e) => setSceneType(e.target.value)}
                className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple"
              >
                <option value="REAL_FOOTAGE">实拍素材</option>
                <option value="ANIMATION">动画素材</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">口播脚本</label>
            <textarea
              value={voiceoverText}
              onChange={(e) => setVoiceoverText(e.target.value)}
              rows={4}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple resize-none"
            />
            <p className="text-xs text-muted-foreground text-right">
              {voiceoverText.length} 字
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">画面描述</label>
            <textarea
              value={visualDesc}
              onChange={(e) => setVisualDesc(e.target.value)}
              rows={3}
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple resize-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">素材检索词</label>
            <input
              value={materialQuery}
              onChange={(e) => setMaterialQuery(e.target.value)}
              placeholder="English search keywords"
              className="w-full bg-secondary border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 p-5 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-border rounded-lg hover:bg-secondary transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-4 py-2 text-sm bg-purple hover:bg-purple-light text-white rounded-lg transition-colors disabled:opacity-50"
          >
            {isSaving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
