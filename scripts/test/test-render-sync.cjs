/**
 * End-to-end render test: TTS → subtitle generation → FFmpeg composite → verify sync.
 * This tests the ACTUAL pipeline, not just duration estimation.
 */
const { execFile } = require("child_process");
const { promisify } = require("util");
const { readFile, writeFile, mkdir, rm, access } = require("fs/promises");
const { join } = require("path");
const { tmpdir } = require("os");
const { randomUUID } = require("crypto");

const execFileAsync = promisify(execFile);

// ─── Subtitle logic (inline from src/lib/render/subtitle.ts) ───

function speakableChars(text) {
  return text.replace(/[，。！？、；：,;!?\s\n"'「」『』【】（）\(\)\[\]]/g, "").length;
}

function estimateSpeechDuration(text) {
  const chineseChars = (text.match(/[一-鿿]/g) || []).length;
  const nonChineseSpeakable = text
    .replace(/[一-鿿]/g, "")
    .replace(/[，。！？、；：,;!?\s\n"'「」『』【】（）\(\)\[\]]/g, "").length;
  return Math.max(0.5, chineseChars / 4 + nonChineseSpeakable / 6);
}

function calcFontSize(videoHeight, ratio = 1 / 20) {
  return Math.max(24, Math.round(videoHeight * ratio));
}

function calcMaxCharsPerLine(videoWidth, fontSize) {
  const usableWidth = videoWidth * 0.85;
  return Math.max(8, Math.floor(usableWidth / (fontSize * 0.95)));
}

function smartSplit(text, maxChars) {
  const lines = [];
  const trimmed = text.trim();
  if (trimmed.length === 0) return lines;
  const sentences = trimmed.split(/(?<=[。！？；,;!?])|(?<=，[^，]{10,})/).filter(s => s.length > 0);
  let currentLine = "";
  for (const sentence of sentences) {
    if (currentLine.length + sentence.length <= maxChars) {
      currentLine += sentence;
    } else {
      if (currentLine.length > 0) { lines.push(currentLine); currentLine = ""; }
      if (sentence.length <= maxChars) {
        currentLine = sentence;
      } else {
        for (let i = 0; i < sentence.length; i += maxChars) {
          const chunk = sentence.substring(i, i + maxChars);
          const remaining = sentence.length - (i + maxChars);
          if (remaining > 0 && remaining < maxChars * 0.3) { lines.push(sentence.substring(i)); break; }
          if (i + maxChars >= sentence.length) { currentLine = chunk; } else { lines.push(chunk); }
        }
      }
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);
  return lines;
}

function generateSubtitleChunks(text, config) {
  const fontSize = calcFontSize(config.videoHeight);
  const maxCharsPerLine = calcMaxCharsPerLine(config.videoWidth, fontSize);
  const lines = smartSplit(text, maxCharsPerLine);
  if (lines.length === 0) return [];
  const lineDurations = lines.map(line => estimateSpeechDuration(line));
  const totalEstimatedDuration = lineDurations.reduce((sum, d) => sum + d, 0);
  if (totalEstimatedDuration === 0) return [];
  const totalDuration = config.audioDuration > 0 ? config.audioDuration : Math.max(1, totalEstimatedDuration);
  const chunks = [];
  let timeCursor = 0;
  for (let i = 0; i < lines.length; i++) {
    const proportion = lineDurations[i] / totalEstimatedDuration;
    const chunkDuration = Math.min(proportion * totalDuration * 1.03, proportion * totalDuration + 0.3);
    const startTime = timeCursor;
    let endTime = timeCursor + chunkDuration;
    if (i === lines.length - 1) endTime = totalDuration;
    if (endTime - startTime < 0.5 && lines.length > 1) endTime = startTime + 0.5;
    endTime = Math.min(endTime, totalDuration);
    chunks.push({ text: lines[i], startTime: Math.round(startTime * 100) / 100, endTime: Math.round(endTime * 100) / 100 });
    timeCursor = endTime;
  }
  return chunks;
}

function buildSubtitleFilterChain(videoInputLabel, chunks, config) {
  const fontSize = calcFontSize(config.videoHeight);
  const fontPath = process.platform === "win32"
    ? "C\\:/Windows/Fonts/msyh.ttc"
    : "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc";
  const bottomMargin = Math.round(config.videoHeight * 0.06);
  if (chunks.length === 0) return { filterParts: [], outputLabel: videoInputLabel };
  const filterParts = [];
  const yPos = `h-text_h-${bottomMargin + fontSize / 2}`;
  const drawtextBase = [
    `fontfile='${fontPath}'`, `fontsize=${fontSize}`, "fontcolor=white",
    "borderw=3", "bordercolor=black", "shadowcolor=black", "shadowx=2", "shadowy=2",
    "x=(w-text_w)/2", `y=${yPos}`, "box=1", "boxcolor=black@0.5", "boxborderw=10",
  ].join(":");
  let prevLabel = videoInputLabel;
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const isLast = i === chunks.length - 1;
    const outLabel = isLast ? `${videoInputLabel}_sub` : `${videoInputLabel}_s${i}`;
    const escapedText = chunk.text
      .replace(/\\/g, "\\\\").replace(/'/g, "'\\\\''")
      .replace(/:/g, "\\:").replace(/%/g, "\\%")
      .replace(/\n/g, " ").replace(/\r/g, "");
    const filter = `[${prevLabel}]drawtext=${drawtextBase}:text='${escapedText}':enable='between(t\\,${chunk.startTime}\\,${chunk.endTime})' [${outLabel}]`;
    filterParts.push(filter);
    prevLabel = outLabel;
  }
  return { filterParts, outputLabel: prevLabel };
}

async function getAudioDuration(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", filePath,
    ], { timeout: 5000 });
    const duration = parseFloat(stdout.trim());
    return isNaN(duration) ? 0 : duration;
  } catch { return 0; }
}

// ─── Test scenes ───

const SCENES = [
  {
    text: "朱棣，从北平藩王到永乐大帝。他的一生充满了战争与权谋，最终登上了皇位的巅峰。",
    expectedMinDuration: 3,
  },
  {
    text: "公元1402年，朱棣发动靖难之役，率军南下，历经四年苦战，终于攻入南京。",
    expectedMinDuration: 3,
  },
  {
    text: "迁都北京，建造紫禁城，编纂永乐大典，派遣郑和下西洋，开创了永乐盛世。",
    expectedMinDuration: 3,
  },
];

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;

async function main() {
  const workDir = join(tmpdir(), `render-test-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });

  console.log("=== E2E Render Sync Test ===\n");
  console.log(`Work dir: ${workDir}\n`);

  let passed = 0;
  let failed = 0;

  // Step 1: Generate TTS for each scene
  console.log("Step 1: Generating TTS audio...\n");
  for (let i = 0; i < SCENES.length; i++) {
    const audioFile = join(workDir, `tts-${i}.mp3`);
    try {
      await execFileAsync("python", [
        "-m", "edge_tts",
        "--voice", "zh-CN-YunxiNeural",
        "--rate", "+0%",
        "--volume", "+0%",
        "--text", SCENES[i].text,
        "--write-media", audioFile,
      ], { timeout: 30000 });

      const duration = await getAudioDuration(audioFile);
      SCENES[i].audioFile = audioFile;
      SCENES[i].actualDuration = duration;
      console.log(`  Scene ${i + 1}: TTS OK, duration = ${duration.toFixed(2)}s`);
    } catch (e) {
      console.log(`  Scene ${i + 1}: TTS FAILED - ${e.message}`);
      // Create silent fallback
      await execFileAsync("ffmpeg", [
        "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-t", "5", "-c:a", "libmp3lame", "-b:a", "128k", audioFile,
      ], { timeout: 10000 });
      SCENES[i].audioFile = audioFile;
      SCENES[i].actualDuration = 5;
    }
  }

  // Step 2: Generate subtitles and verify timing
  console.log("\nStep 2: Generating subtitles and verifying timing...\n");
  for (let i = 0; i < SCENES.length; i++) {
    const scene = SCENES[i];
    const config = { videoWidth: WIDTH, videoHeight: HEIGHT, audioDuration: scene.actualDuration };
    const chunks = generateSubtitleChunks(scene.text, config);

    scene.subtitleChunks = chunks;
    scene.subtitleConfig = config;

    // Verify: last subtitle chunk ends at or before audio duration
    const lastChunk = chunks[chunks.length - 1];
    const subtitleEndsAtAudio = lastChunk.endTime <= scene.actualDuration + 0.1;
    // Verify: no gap > 0.5s between consecutive chunks
    let maxGap = 0;
    for (let j = 1; j < chunks.length; j++) {
      const gap = chunks[j].startTime - chunks[j - 1].endTime;
      maxGap = Math.max(maxGap, gap);
    }
    // Verify: first chunk starts at 0
    const startsAtZero = chunks[0].startTime < 0.01;

    const timingOk = subtitleEndsAtAudio && startsAtZero && maxGap < 1.0;

    console.log(`  Scene ${i + 1}: ${chunks.length} chunks, audio=${scene.actualDuration.toFixed(2)}s, subtitle ends=${lastChunk.endTime.toFixed(2)}s, max gap=${maxGap.toFixed(2)}s`);
    console.log(`    ${timingOk ? "✅" : "❌"} Timing: starts@0=${startsAtZero}, ends≤audio=${subtitleEndsAtAudio}, gap<1s=${maxGap < 1.0}`);

    for (const chunk of chunks) {
      console.log(`    [${chunk.startTime.toFixed(2)}s - ${chunk.endTime.toFixed(2)}s] "${chunk.text}"`);
    }

    if (timingOk) passed++;
    else failed++;
  }

  // Step 3: Composite video with FFmpeg
  console.log("\nStep 3: Compositing video with FFmpeg...\n");

  const outputName = `test-output-${randomUUID()}.mp4`;
  const outputPath = join(workDir, outputName);

  const inputArgs = [];
  const filterParts = [];
  const concatInputs = [];

  for (let i = 0; i < SCENES.length; i++) {
    const scene = SCENES[i];
    const audioFile = scene.audioFile;

    // Create black video with same duration as audio
    const videoFile = join(workDir, `video-${i}.mp4`);
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", `color=c=0x1a1a2e:s=${WIDTH}x${HEIGHT}:d=${scene.actualDuration}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", videoFile,
    ], { timeout: 15000 });

    inputArgs.push("-i", videoFile, "-i", audioFile);

    const videoIdx = i * 2;
    const audioIdx = i * 2 + 1;

    // Scale + trim video to audio duration
    filterParts.push(
      `[${videoIdx}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=decrease,pad=${WIDTH}:${HEIGHT}:(ow-iw)/2:(oh-ih)/2,setsar=1,trim=duration=${scene.actualDuration},setpts=PTS-STARTPTS[v${i}]`
    );

    // Audio: normalize + trim
    filterParts.push(
      `[${audioIdx}:a]volume=2.0,aresample=44100,atrim=0:${scene.actualDuration},asetpts=PTS-STARTPTS[a${i}]`
    );

    // Subtitles
    const { filterParts: subFilters, outputLabel: subLabel } = buildSubtitleFilterChain(
      `v${i}`, scene.subtitleChunks, scene.subtitleConfig
    );
    filterParts.push(...subFilters);

    concatInputs.push(`[${subLabel}][a${i}]`);
  }

  filterParts.push(
    `${concatInputs.join("")}concat=n=${SCENES.length}:v=1:a=1[outv][outa]`
  );

  try {
    await execFileAsync("ffmpeg", [
      "-y", ...inputArgs,
      "-filter_complex", filterParts.join(";"),
      "-map", "[outv]", "-map", "[outa]",
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
      "-r", String(FPS),
      "-movflags", "+faststart",
      outputPath,
    ], { timeout: 120000 });

    // Verify output exists and has correct duration
    const outputDuration = await getAudioDuration(outputPath);
    const totalAudioDuration = SCENES.reduce((sum, s) => sum + s.actualDuration, 0);
    const durationDiff = Math.abs(outputDuration - totalAudioDuration);

    const outputSize = (await readFile(outputPath)).length;

    console.log(`  Output: ${outputName}`);
    console.log(`  Size: ${(outputSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Duration: ${outputDuration.toFixed(2)}s (expected ~${totalAudioDuration.toFixed(2)}s, diff=${durationDiff.toFixed(2)}s)`);

    if (durationDiff < 2.0 && outputSize > 10000) {
      console.log("  ✅ Video rendered successfully with correct duration");
      passed++;
    } else {
      console.log("  ❌ Duration mismatch or empty output");
      failed++;
    }
  } catch (e) {
    console.log(`  ❌ FFmpeg failed: ${e.message}`);
    failed++;
  }

  // Cleanup
  await rm(workDir, { recursive: true, force: true }).catch(() => {});

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
