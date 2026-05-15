import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface SceneInput {
  videoPath: string;
  audioPath: string;
  duration: number;
  subtitleText?: string;
  transition?: string;
}

export async function compositeVideo(
  scenes: SceneInput[],
  outputPath: string,
  options: { width: number; height: number; fps?: number }
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
      const escapedText = scene.subtitleText.replace(/'/g, "\\'").replace(/:/g, "\\:");
      filterParts.push(
        `[v${i}]drawtext=text='${escapedText}':fontsize=24:fontcolor=white:borderw=2:bordercolor=black:x=(w-text_w)/2:y=h-text_h-30[v${i}sub]`
      );
    }
  });

  const concatInputs = scenes
    .map((_, i) => {
      const videoLabel = scenes[i].subtitleText ? `[v${i}sub]` : `[v${i}]`;
      return `${videoLabel}[${i * 2 + 1}:a]`;
    })
    .join("");

  filterParts.push(
    `${concatInputs}concat=n=${scenes.length}:v=1:a=1[outv][outa]`
  );

  const filterComplex = filterParts.join(";");

  await execFileAsync("ffmpeg", [
    "-y",
    ...inputArgs,
    "-filter_complex",
    filterComplex,
    "-map",
    "[outv]",
    "-map",
    "[outa]",
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
