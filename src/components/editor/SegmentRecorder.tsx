"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Video,
  Square,
  Upload,
  X,
  Check,
  Loader2,
  Camera,
} from "lucide-react";

interface SegmentRecorderProps {
  projectId: string;
  onSegmentAdded: () => void;
  onClose: () => void;
}

export function SegmentRecorder({
  projectId,
  onSegmentAdded,
  onClose,
}: SegmentRecorderProps) {
  const [mode, setMode] = useState<"record" | "upload">("upload");
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [segmentName, setSegmentName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1920, height: 1080 },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      setError("无法访问摄像头，请检查权限设置");
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const startRecording = useCallback(() => {
    if (!streamRef.current) return;

    chunksRef.current = [];
    const mediaRecorder = new MediaRecorder(streamRef.current, {
      mimeType: "video/webm;codecs=vp9,opus",
    });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      setRecordedBlob(blob);
      setPreviewUrl(URL.createObjectURL(blob));
    };

    mediaRecorderRef.current = mediaRecorder;
    mediaRecorder.start(100);
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      stopCamera();
    }
  }, [isRecording, stopCamera]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("video/")) {
      setError("请选择视频文件");
      return;
    }

    setUploadFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    if (!segmentName) {
      setSegmentName(file.name.replace(/\.[^/.]+$/, ""));
    }
  };

  const handleUpload = async () => {
    const file = uploadFile || recordedBlob;
    if (!file) return;

    setIsUploading(true);
    setError(null);

    try {
      const formData = new FormData();
      const videoFile =
        file instanceof Blob
          ? new File([file], segmentName || "segment.webm", {
              type: file.type,
            })
          : file;

      formData.append("video", videoFile);
      formData.append("name", segmentName || `片段 ${Date.now()}`);

      const res = await fetch(`/api/projects/${projectId}/segments/upload`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "上传失败");
      }

      onSegmentAdded();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    if (mode === "record") {
      startCamera();
    }
    return () => {
      stopCamera();
    };
  }, [mode, startCamera, stopCamera]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">添加视频片段</h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-secondary rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mode tabs */}
        <div className="flex gap-2 px-6 pt-4">
          <button
            onClick={() => setMode("upload")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === "upload"
                ? "bg-purple text-white"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            <Upload className="w-4 h-4" />
            上传视频
          </button>
          <button
            onClick={() => setMode("record")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === "record"
                ? "bg-purple text-white"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            <Camera className="w-4 h-4" />
            录制视频
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {mode === "upload" && !previewUrl && (
            <label className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-purple/50 transition-colors">
              <Upload className="w-12 h-12 text-muted-foreground mb-4" />
              <p className="text-sm text-muted-foreground">
                点击或拖拽视频文件到此处
              </p>
              <p className="text-xs text-muted-foreground/60 mt-1">
                支持 MP4、WebM、MOV 格式
              </p>
              <input
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                className="hidden"
              />
            </label>
          )}

          {mode === "record" && (
            <div className="relative rounded-xl overflow-hidden bg-black">
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-64 object-contain"
              />
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-3">
                {!isRecording && !recordedBlob && (
                  <button
                    onClick={startRecording}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-full text-sm font-medium transition-colors"
                  >
                    <Video className="w-4 h-4" />
                    开始录制
                  </button>
                )}
                {isRecording && (
                  <button
                    onClick={stopRecording}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-full text-sm font-medium transition-colors animate-pulse"
                  >
                    <Square className="w-4 h-4" />
                    停止录制
                  </button>
                )}
              </div>
              {isRecording && (
                <div className="absolute top-4 right-4 flex items-center gap-2 px-3 py-1 bg-red-500/80 rounded-full">
                  <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
                  <span className="text-white text-xs font-medium">
                    录制中
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Preview */}
          {previewUrl && (
            <div className="relative rounded-xl overflow-hidden">
              <video
                src={previewUrl}
                controls
                className="w-full h-64 object-contain bg-black"
              />
              <button
                onClick={() => {
                  setPreviewUrl(null);
                  setUploadFile(null);
                  setRecordedBlob(null);
                }}
                className="absolute top-2 right-2 p-1.5 bg-black/60 hover:bg-black/80 rounded-full transition-colors"
              >
                <X className="w-4 h-4 text-white" />
              </button>
            </div>
          )}

          {/* Segment name */}
          <div className="space-y-2">
            <label className="text-sm font-medium">片段名称</label>
            <input
              value={segmentName}
              onChange={(e) => setSegmentName(e.target.value)}
              placeholder="输入片段名称..."
              className="w-full bg-secondary border border-border rounded-lg px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple"
            />
          </div>

          {error && (
            <div className="text-sm text-red-400 bg-red-400/10 px-4 py-2 rounded-lg">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleUpload}
            disabled={(!uploadFile && !recordedBlob) || isUploading}
            className="flex items-center gap-2 px-6 py-2 bg-purple hover:bg-purple-light text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                上传中...
              </>
            ) : (
              <>
                <Check className="w-4 h-4" />
                添加片段
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
