import { execFile } from "child_process";
import { promisify } from "util";
import {
  generateSubtitleChunks,
  buildSubtitleFilterChain,
  estimateAudioDuration,
  type SubtitleConfig,
} from "./subtitle";

const execFileAsync = promisify(execFile);

export interface SceneInput {
  videoPath: string;
  audioPath: string;
  duration: number;
  subtitleText?: string;
  transition?: string;
}

export interface MusicInput {
  filePath: string;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  totalDuration: number;
}

export async function compositeVideo(
  scenes: SceneInput[],
  outputPath: string,
  options: { width: number; height: number; fps?: number; music?: MusicInput }
): Promise<void> {
  const fps = options.fps || 30;

  if (scenes.length === 0) throw new Error("No scenes to composite");

  const filterParts: string[] = [];
  const inputArgs: string[] = [];

  scenes.forEach((scene, i) => {
    inputArgs.push("-i", scene.videoPath);
    inputArgs.push("-i", scene.audioPath);

    const videoIdx = i * 2;
    const audioIdx = i * 2 + 1;

    filterParts.push(
      `[${videoIdx}:v]scale=${options.width}:${options.height}:force_original_aspect_ratio=decrease,pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}]`
    );

    if (scene.subtitleText) {
      const subtitleConfig: SubtitleConfig = {
        videoWidth: options.width,
        videoHeight: options.height,
        audioDuration: scene.duration || estimateAudioDuration(scene.subtitleText),
      };
      const chunks = generateSubtitleChunks(scene.subtitleText, subtitleConfig);
      const { filterParts: subFilters, outputLabel: subLabel } = buildSubtitleFilterChain(
        `v${i}`,
        chunks,
        subtitleConfig
      );
      filterParts.push(...subFilters);
      // Mark that this scene has subtitle label for concat
      (scene as any)._subLabel = subLabel;
    }
  });

  const concatInputs = scenes
    .map((scene, i) => {
      const videoLabel = (scene as any)._subLabel || `v${i}`;
      return `[${videoLabel}][${i * 2 + 1}:a]`;
    })
    .join("");

  // Concat all scenes
  filterParts.push(
    `${concatInputs}concat=n=${scenes.length}:v=1:a=1[outv][outa]`
  );

  let finalAudioMap = "[outa]";

  // Add background music mixing if provided
  if (options.music) {
    inputArgs.push("-i", options.music.filePath);
    const musicInputIdx = scenes.length * 2;

    const musicFilters = [
      `[${musicInputIdx}:a]volume=${options.music.volume}`,
      `afade=t=in:st=0:d=${options.music.fadeIn}`,
      `afade=t=out:st=${options.music.totalDuration - options.music.fadeOut}:d=${options.music.fadeOut}`,
      `[bgm]`,
    ].join(",");

    filterParts.push(musicFilters);
    filterParts.push(
      `[outa][bgm]amix=inputs=2:duration=first:dropout_transition=2[finala]`
    );
    finalAudioMap = "[finala]";
  }

  const filterComplex = filterParts.join(";");

  await execFileAsync("ffmpeg", [
    "-y",
    ...inputArgs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[outv]",
    "-map",
    finalAudioMap,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-r",
    String(fps),
    outputPath,
  ], { timeout: 600000 });
}
