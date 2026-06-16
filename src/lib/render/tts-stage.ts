/**
 * TTS generation stage — extracted from pipeline.ts.
 *
 * Handles: Edge TTS (via spawn) and MiMo TTS generation for all scenes.
 * Each scene gets an audio file; failures produce silent fallback audio
 * with warnings persisted to RenderJob and Scene.
 *
 * Extracted from pipeline.ts as part of #38 (pipeline split).
 */

import { spawn } from "child_process";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile } from "fs/promises";
import { join } from "path";

const execFileAsync = promisify(execFile);

// ── helpers (to be deduplicated with pipeline.ts later) ──

async function getAudioDurationFn(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], { timeout: 5000 });
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

export interface TTSSceneInput {
  index: number;
  voiceoverText: string;
  /** Already-existing audio URL (skip generation if valid) */
  audioUrl?: string | null;
  /** Existing duration from previous TTS pass */
  audioDuration?: number | null;
}

export interface TTSSceneOutput {
  index: number;
  /** Path to the generated audio file */
  audioFile: string;
  /** Actual duration in seconds (ffprobe measured or estimated) */
  duration: number;
  /** Warning message if TTS fell back to silence */
  warning?: string;
}

export interface TTSPipelineConfig {
  /** Work directory for temporary files */
  workDir: string;
  /** Maximum concurrent TTS generations */
  concurrency: number;
  /** User's TTS provider preference */
  ttsProvider?: string | null;
  /** User's selected TTS voice */
  ttsVoice?: string | null;
  /** MiMo API key (decrypted) */
  mimoApiKey?: string;
  /** MiMo base URL */
  mimoBaseUrl?: string;
}

/**
 * Generate TTS audio for all scenes with configurable concurrency.
 *
 * @returns Scene outputs + accumulated warning messages for RenderJob.
 */
export async function generateTTSSceneAudio(
  scenes: TTSSceneInput[],
  config: TTSPipelineConfig
): Promise<{ outputs: TTSSceneOutput[]; warnings: string[] }> {
  const { mapConcurrent } = await import("@/lib/utils/concurrent");
  const { estimateAudioDuration } = await import("./subtitle");

  const warnings: string[] = [];
  const getAudioDuration = getAudioDurationFn;

  const results = await mapConcurrent(scenes, config.concurrency, async (scene) => {
    const { index, voiceoverText } = scene;
    const audioFile = join(config.workDir, `tts-${index}.mp3`);
    const estimatedDuration = estimateAudioDuration(voiceoverText);

    // Check for existing valid audio
    if (scene.audioUrl) {
      try {
        const dur = await getAudioDuration(audioFile);
        if (dur > 0) return { index, audioFile, duration: dur };
      } catch {}
    }

    const isMiMo = config.ttsProvider === "mimo";

    if (isMiMo) {
      // MiMo TTS path
      const mimoVoice = config.ttsVoice || "冰糖";
      const mimoApiKey = config.mimoApiKey || process.env.MIMO_API_KEY || "";
      const mimoBaseUrl = config.mimoBaseUrl || "https://token-plan-cn.xiaomimimo.com/v1";

      try {
        const res = await fetch(`${mimoBaseUrl}/chat/completions`, {
          method: "POST",
          headers: { "api-key": mimoApiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "mimo-v2.5-tts",
            messages: [{ role: "assistant", content: voiceoverText }],
            audio: { format: "wav", voice: mimoVoice },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const audioData = data.choices?.[0]?.message?.audio?.data;
          if (audioData) {
            await writeFile(audioFile, Buffer.from(audioData, "base64"));
            const actualDuration = await getAudioDuration(audioFile);
            if (actualDuration > 0) return { index, audioFile, duration: actualDuration };
          }
        }

        const warnMsg = `MiMo TTS failed for scene ${index} — using silent audio (${estimatedDuration.toFixed(1)}s)`;
        console.warn(`[TTS] ${warnMsg}`);
        warnings.push(`Scene #${index + 1}: ${warnMsg}`);
      } catch (err) {
        const warnMsg = `MiMo TTS error for scene ${index}: ${err instanceof Error ? err.message : "unknown"}`;
        console.warn(`[TTS] ${warnMsg}`);
        warnings.push(`Scene #${index + 1}: ${warnMsg}`);
      }

      // Fallback: generate silent audio
      await generateSilentAudio(audioFile, estimatedDuration);
      return { index, audioFile, duration: estimatedDuration, warning: "TTS failed — silent fallback" };
    }

    // Edge TTS path — try multiple Python paths for cross-platform compat
    // (Windows typically only has "python", Linux/macOS may have "python3").
    const pythonPaths = ["python", "python3"];
    let ttsOk = false;
    for (const py of pythonPaths) {
      try {
        await runEdgeTTS(py, voiceoverText, config.ttsVoice || "zh-CN-YunxiNeural", audioFile, 60000);
        const actualDuration = await getAudioDuration(audioFile);
        if (actualDuration > 0) {
          ttsOk = true;
          break;
        }
        // File exists but invalid — try next Python path
        const warnMsg = `Edge TTS (via ${py}) produced invalid output for scene ${index}`;
        warnings.push(`Scene #${index + 1}: ${warnMsg}`);
      } catch (err) {
        // This Python path failed — try the next one before giving up
        continue;
      }
    }
    if (!ttsOk) {
      const warnMsg = `Edge TTS failed for scene ${index} (tried ${pythonPaths.join(", ")}) — using silent audio`;
      console.warn(`[TTS] ${warnMsg}`);
      warnings.push(`Scene #${index + 1}: ${warnMsg}`);
    } else {
      return { index, audioFile, duration: await getAudioDuration(audioFile) };
    }

    await generateSilentAudio(audioFile, estimatedDuration);
    return { index, audioFile, duration: estimatedDuration, warning: "TTS failed — silent fallback" };
  });

  return { outputs: results, warnings };
}

/**
 * Run edge_tts via spawn with array args (NO shell, NO injection).
 */
function runEdgeTTS(
  pythonCmd: string,
  text: string,
  voice: string,
  outputFile: string,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonCmd,
      ["-m", "edge_tts", "--voice", voice, "--rate", "+0%", "--text", text, "--write-media", outputFile],
      { stdio: ["ignore", "ignore", "pipe"], windowsHide: true }
    );

    let stderrBuf = "";
    child.stderr?.on("data", (b: Buffer) => (stderrBuf += b.toString()));

    const killTimer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);

    child.on("error", (err) => { clearTimeout(killTimer); reject(err); });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      if (code === 0) resolve();
      else reject(new Error(`edge_tts exited ${code}: ${stderrBuf.slice(0, 500)}`));
    });
  });
}

/**
 * Generate silent MP3 audio of specified duration.
 */
async function generateSilentAudio(outputFile: string, durationSec: number): Promise<void> {
  try {
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-t", String(durationSec), "-c:a", "libmp3lame", "-b:a", "128k",
      outputFile,
    ], { timeout: 10000 });
  } catch {
    // Last resort: write WAV silence manually
    const sampleRate = 44100;
    const channels = 2;
    const bytesPerSample = 2;
    const numSamples = Math.ceil(durationSec * sampleRate);
    const dataSize = numSamples * channels * bytesPerSample;
    const headerSize = 44;
    const wav = Buffer.alloc(headerSize + dataSize);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + dataSize, 4);
    wav.write("WAVE", 8);
    wav.write("fmt ", 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(channels, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
    wav.writeUInt16LE(channels * bytesPerSample, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(dataSize, 40);
    await writeFile(outputFile.replace(/\.mp3$/, ".wav"), wav).catch(() => {});
  }
}
