import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

export interface TTSOptions {
  voice?: string;
  rate?: string;
  volume?: string;
}

const DEFAULT_VOICE = "zh-CN-YunxiNeural";

export async function generateTTS(
  text: string,
  options: TTSOptions = {}
): Promise<Buffer> {
  const voice = options.voice || DEFAULT_VOICE;
  const rate = options.rate || "+0%";
  const volume = options.volume || "+0%";

  const id = randomUUID();
  const outputFile = join(tmpdir(), `tts-${id}.mp3`);

  try {
    await execFileAsync("python", [
      "-m",
      "edge_tts",
      "--voice",
      voice,
      "--rate",
      rate,
      "--volume",
      volume,
      "--text",
      text,
      "--write-media",
      outputFile,
    ], { timeout: 30000 });

    const buffer = await readFile(outputFile);
    return buffer;
  } finally {
    await unlink(outputFile).catch(() => {});
  }
}
