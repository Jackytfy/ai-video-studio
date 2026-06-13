"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export interface RenderJobProgress {
  id: string;
  status: string;
  progress: number;
  currentStage: string | null;
  errorMessage: string | null;
  outputUrl: string | null;
}

export interface SceneProgress {
  ttsDone: number;
  ttsTotal: number;
  renderDone: number;
  renderTotal: number;
}

export interface ProjectEvent {
  type: "init" | "update" | "done" | "error";
  status?: string;
  renderJob?: RenderJobProgress | null;
  sceneProgress?: SceneProgress;
  sceneCount?: number;
  message?: string;
}

export function useProjectEvents(projectId: string | undefined) {
  const [projectStatus, setProjectStatus] = useState<string>("");
  const [renderJob, setRenderJob] = useState<RenderJobProgress | null>(null);
  const [sceneProgress, setSceneProgress] = useState<SceneProgress>({
    ttsDone: 0,
    ttsTotal: 0,
    renderDone: 0,
    renderTotal: 0,
  });
  const [isConnected, setIsConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const connect = useCallback(() => {
    if (!projectId) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(`/api/projects/${projectId}/events`);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
    };

    es.onmessage = (e) => {
      try {
        const data: ProjectEvent = JSON.parse(e.data);

        if (data.status) {
          setProjectStatus(data.status);
        }
        if (data.renderJob !== undefined) {
          setRenderJob(data.renderJob);
        }
        if (data.sceneProgress) {
          setSceneProgress(data.sceneProgress);
        }

        if (data.type === "done" || data.type === "error") {
          es.close();
          eventSourceRef.current = null;
          setIsConnected(false);
        }
      } catch {}
    };

    es.onerror = () => {
      es.close();
      eventSourceRef.current = null;
      setIsConnected(false);

      // Auto-reconnect after 5s
      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, 5000);
    };
  }, [projectId]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
    };
  }, [connect]);

  return {
    projectStatus,
    renderJob,
    sceneProgress,
    isConnected,
  };
}
