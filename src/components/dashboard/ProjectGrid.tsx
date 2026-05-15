"use client";

import { ProjectCard } from "./ProjectCard";

interface Project {
  id: string;
  name: string;
  status: string;
  aspectRatio: string;
  contentStyle: string;
  createdAt: string;
  updatedAt: string;
  storyboard?: {
    totalScenes: number;
    totalDuration: number | null;
    status: string;
  } | null;
}

interface ProjectGridProps {
  projects: Project[];
}

export function ProjectGrid({ projects }: ProjectGridProps) {
  if (projects.length === 0) {
    return (
      <div className="text-center py-16">
        <p className="text-muted-foreground mb-4">还没有任何项目</p>
        <a
          href="/"
          className="inline-flex items-center gap-2 bg-purple hover:bg-purple-light text-white px-6 py-2.5 rounded-lg font-medium transition-colors"
        >
          创建第一个项目
        </a>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}
