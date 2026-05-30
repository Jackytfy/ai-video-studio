"use client";

import { SceneCard } from "./SceneCard";

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

interface StoryboardTimelineProps {
  scenes: Scene[];
  onEditScene: (scene: Scene) => void;
}

export function StoryboardTimeline({ scenes, onEditScene }: StoryboardTimelineProps) {
  if (scenes.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p>暂无场景</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {scenes.map((scene) => (
        <SceneCard key={scene.id} scene={scene} onEdit={onEditScene} />
      ))}
    </div>
  );
}
