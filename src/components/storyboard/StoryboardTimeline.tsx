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
    <div className="overflow-x-auto pb-4">
      <div className="flex gap-4 min-w-min">
        {scenes.map((scene) => (
          <SceneCard key={scene.id} scene={scene} onEdit={onEditScene} />
        ))}
      </div>
    </div>
  );
}
