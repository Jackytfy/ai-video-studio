"use client";

import { useState, useRef, useEffect } from "react";
import {
  Music,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Loader2,
  Wand2,
  X,
  Check,
  Upload,
} from "lucide-react";

interface MusicTrack {
  id: string;
  name: string;
  fileUrl: string;
  duration: number;
  volume: number;
  mood?: string;
  genre?: string;
  isBgm: boolean;
}

interface MusicSelectorProps {
  projectId: string;
  tracks: MusicTrack[];
  scriptContent?: string;
  onTracksChange: (tracks: MusicTrack[]) => void;
}

export function MusicSelector({
  projectId,
  tracks,
  scriptContent,
  onTracksChange,
}: MusicSelectorProps) {
  const [activeTab, setActiveTab] = useState<"library" | "ai" | "upload">(
    "ai"
  );
  const [aiSuggestions, setAiSuggestions] = useState<
    Array<{
      name: string;
      mood: string;
      genre: string;
      description: string;
      searchQuery: string;
    }>
  >([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.3);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const generateSuggestions = async () => {
    if (!scriptContent) return;
    setIsGenerating(true);

    try {
      const res = await fetch(`/api/projects/${projectId}/music/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: scriptContent }),
      });

      if (res.ok) {
        const data = await res.json();
        setAiSuggestions(data.suggestions);
      }
    } catch {
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePlay = (url: string, id: string) => {
    if (playingId === id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }

    if (audioRef.current) {
      audioRef.current.pause();
    }

    const audio = new Audio(url);
    audio.volume = volume;
    audio.onended = () => setPlayingId(null);
    audio.play();
    audioRef.current = audio;
    setPlayingId(id);
  };

  const handleAddTrack = async (track: {
    name: string;
    fileUrl?: string;
    mood?: string;
    genre?: string;
  }) => {
    // If it's a library track with a fileUrl, add directly
    if (track.fileUrl) {
      const newTrack: MusicTrack = {
        id: `track-${Date.now()}`,
        name: track.name,
        fileUrl: track.fileUrl,
        duration: 0,
        volume,
        mood: track.mood,
        genre: track.genre,
        isBgm: true,
      };
      onTracksChange([...tracks, newTrack]);
      return;
    }

    // For AI suggestions, search for matching music
    try {
      const res = await fetch(`/api/projects/${projectId}/music/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: track.name,
          mood: track.mood,
          genre: track.genre,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        if (data.track) {
          onTracksChange([...tracks, { ...data.track, volume, isBgm: true }]);
        }
      }
    } catch {}
  };

  const handleRemoveTrack = (trackId: string) => {
    onTracksChange(tracks.filter((t) => t.id !== trackId));
  };

  const handleVolumeChange = (trackId: string, vol: number) => {
    onTracksChange(
      tracks.map((t) => (t.id === trackId ? { ...t, volume: vol } : t))
    );
  };

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Music className="w-4 h-4 text-purple" />
          <span className="text-sm font-medium">背景音乐</span>
        </div>
        <div className="flex gap-1">
          {(["ai", "library", "upload"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                activeTab === tab
                  ? "bg-purple text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab === "ai" ? "AI 推荐" : tab === "library" ? "音乐库" : "上传"}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Current tracks */}
        {tracks.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">已添加的音乐</p>
            {tracks.map((track) => (
              <div
                key={track.id}
                className="flex items-center gap-3 bg-secondary rounded-lg px-3 py-2"
              >
                <button
                  onClick={() => handlePlay(track.fileUrl, track.id)}
                  className="w-8 h-8 rounded-full bg-purple/10 hover:bg-purple/20 flex items-center justify-center transition-colors"
                >
                  {playingId === track.id ? (
                    <Pause className="w-3.5 h-3.5 text-purple" />
                  ) : (
                    <Play className="w-3.5 h-3.5 text-purple ml-0.5" />
                  )}
                </button>

                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{track.name}</p>
                  {track.mood && (
                    <p className="text-xs text-muted-foreground">
                      {track.mood} · {track.genre}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Volume2 className="w-3.5 h-3.5 text-muted-foreground" />
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={track.volume}
                    onChange={(e) =>
                      handleVolumeChange(track.id, parseFloat(e.target.value))
                    }
                    className="w-20 accent-purple"
                  />
                </div>

                <button
                  onClick={() => handleRemoveTrack(track.id)}
                  className="p-1 hover:bg-secondary rounded transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* AI Suggestions */}
        {activeTab === "ai" && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <button
                onClick={generateSuggestions}
                disabled={isGenerating || !scriptContent}
                className="flex items-center gap-2 px-4 py-2 bg-purple/10 hover:bg-purple/20 text-purple rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {isGenerating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Wand2 className="w-4 h-4" />
                )}
                {isGenerating ? "分析中..." : "根据文案智能推荐"}
              </button>
            </div>

            {aiSuggestions.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {aiSuggestions.map((suggestion, i) => (
                  <button
                    key={i}
                    onClick={() => handleAddTrack(suggestion)}
                    className="text-left bg-secondary hover:bg-secondary/80 rounded-lg p-3 transition-colors group"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium">
                        {suggestion.name}
                      </span>
                      <Check className="w-4 h-4 text-purple opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {suggestion.description}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <span className="text-[10px] px-1.5 py-0.5 bg-purple/10 text-purple rounded">
                        {suggestion.mood}
                      </span>
                      <span className="text-[10px] px-1.5 py-0.5 bg-secondary text-muted-foreground rounded">
                        {suggestion.genre}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Upload */}
        {activeTab === "upload" && (
          <label className="flex flex-col items-center justify-center h-32 border-2 border-dashed border-border rounded-xl cursor-pointer hover:border-purple/50 transition-colors">
            <Upload className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">上传音乐文件</p>
            <p className="text-xs text-muted-foreground/60">支持 MP3、WAV 格式</p>
            <input
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;

                const formData = new FormData();
                formData.append("audio", file);
                formData.append("name", file.name.replace(/\.[^/.]+$/, ""));

                try {
                  const res = await fetch(
                    `/api/projects/${projectId}/music/upload`,
                    { method: "POST", body: formData }
                  );
                  if (res.ok) {
                    const data = await res.json();
                    onTracksChange([
                      ...tracks,
                      { ...data.track, volume, isBgm: true },
                    ]);
                  }
                } catch {}
              }}
            />
          </label>
        )}
      </div>
    </div>
  );
}
