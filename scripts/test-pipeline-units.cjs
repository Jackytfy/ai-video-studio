/**
 * Unit test for render pipeline fixes:
 *   1. TTS duration verification
 *   2. Video tpad+trim sync with audio
 *   3. Subtitle sync with actual audio duration
 *   4. Short video extension via tpad
 *
 * Usage: node scripts/test-pipeline-units.cjs
 *
 * No dev server needed — tests FFmpeg + subtitle logic directly.
 */

const { execFile, exec } = require("child_process");
const { promisify } = require("util");
const { writeFile, readFile, mkdir, rm } = require("fs/promises");
const { join } = require("path");
const { tmpdir } = require("os");

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const WORK_DIR = join(tmpdir(), `pipeline-test-${Date.now()}`);

// ==================== Subtitle logic (mirrored from subtitle.ts) ====================

function estimateSpeechDuration(text) {
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const nonChinese = text
    .replace(/[\u4e00-\u9fff]/g, "")
    .replace(/[，。！？、；：,;!?\s\n"'「」『』【】（）()\[\]·《》—\-—]/g, "").length;
  return Math.max(0.8, chineseChars / 3.5 + nonChinese / 5);
}

function generateSubtitleChunks(text, audioDuration) {
  const sentences = text.split(/(?<=[。！？；\n.!?;])/).map(s => s.trim()).filter(Boolean);
  if (sentences.length === 0) return [{ text, startTime: 0, endTime: audioDuration }];

  const merged = [];
  let buf = "";
  for (const seg of sentences) {
    buf += seg;
    if (buf.length >= 6 || /[。！？.!?]/.test(seg)) {
      merged.push(buf);
      buf = "";
    }
  }
  if (buf) {
    if (merged.length > 0) merged[merged.length - 1] += buf;
    else merged.push(buf);
  }

  const scriptDurations = merged.map(t => estimateSpeechDuration(t));
  const totalScriptDuration = scriptDurations.reduce((sum, d) => sum + d, 0);
  if (totalScriptDuration === 0) return [];

  const chunks = [];
  let timeCursor = 0;

  for (let i = 0; i < merged.length; i++) {
    const proportion = scriptDurations[i] / totalScriptDuration;
    const dur = proportion * audioDuration;
    const startTime = timeCursor;
    const endTime = i === merged.length - 1 ? audioDuration : timeCursor + dur;
    chunks.push({
      text: merged[i],
      startTime: Math.round(startTime * 100) / 100,
      endTime: Math.round(endTime * 100) / 100,
    });
    timeCursor = endTime;
  }
  return chunks;
}

// ==================== Tests ====================

async function getAudioDuration(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", filePath,
    ], { timeout: 5000 });
    return parseFloat(stdout.trim()) || 0;
  } catch { return 0; }
}

async function getVideoDuration(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", filePath,
    ], { timeout: 5000 });
    return parseFloat(stdout.trim()) || 0;
  } catch { return 0; }
}

async function test1_TTSDurationVerification() {
  console.log("\n--- Test 1: TTS Duration Verification ---");
  const text = "公元663年，白江口，唐军约170艘战船，面对倭国数倍于己的水军。";
  const audioFile = join(WORK_DIR, "test-tts.mp3");

  // Generate TTS
  const ttsOk = await generateTTS(text, "zh-CN-YunxiNeural", audioFile);
  if (!ttsOk) {
    console.log("  SKIP: edge-tts not available");
    return;
  }

  const actualDuration = await getAudioDuration(audioFile);
  const estimatedDuration = estimateSpeechDuration(text);
  const ratio = actualDuration / estimatedDuration;

  console.log(`  Text: "${text.substring(0, 30)}..."`);
  console.log(`  Estimated: ${estimatedDuration.toFixed(2)}s`);
  console.log(`  Actual TTS: ${actualDuration.toFixed(2)}s`);
  console.log(`  Ratio (actual/estimated): ${ratio.toFixed(2)}`);

  // Check: actual should be within 0.5x - 2.0x of estimated
  if (ratio < 0.5 || ratio > 2.0) {
    console.log(`  WARN: TTS duration ratio is ${ratio.toFixed(2)}, expected 0.5-2.0`);
  } else {
    console.log("  PASS: TTS duration is reasonable");
  }

  // Key test: using actual duration for subtitle sync
  const chunksEstimated = generateSubtitleChunks(text, estimatedDuration);
  const chunksActual = generateSubtitleChunks(text, actualDuration);

  console.log(`  Subtitle chunks (estimated): ${chunksEstimated.length} chunks`);
  console.log(`  Subtitle chunks (actual): ${chunksActual.length} chunks`);
  console.log(`  Last chunk end (estimated): ${chunksEstimated[chunksEstimated.length - 1]?.endTime.toFixed(2)}s`);
  console.log(`  Last chunk end (actual): ${chunksActual[chunksActual.length - 1]?.endTime.toFixed(2)}s`);

  if (Math.abs(chunksActual[chunksActual.length - 1]?.endTime - actualDuration) < 0.1) {
    console.log("  PASS: Subtitles sync with actual audio duration");
  } else {
    console.log("  FAIL: Subtitles don't sync with actual audio duration");
  }
}

async function test2_VideoTpadTrim() {
  console.log("\n--- Test 2: Video tpad+trim Sync with Audio ---");

  // Create a 3-second test video (simulating short material)
  const shortVideo = join(WORK_DIR, "short-video.mp4");
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i",
    `color=c=0x333366:s=1920x1080:d=3,drawtext=fontfile='C\\:/Windows/Fonts/msyh.ttc':fontsize=48:fontcolor=white:text='Short 3s Video':x=(w-text_w)/2:y=(h-text_h)/2`,
    "-c:v", "libx264", "-t", "3", "-pix_fmt", "yuv420p",
    "-an", shortVideo,
  ], { timeout: 15000 });

  const shortDur = await getVideoDuration(shortVideo);
  console.log(`  Short video duration: ${shortDur.toFixed(2)}s`);

  // Simulate audio duration of 8s (longer than video)
  const audioDuration = 8.0;
  const outputVideo = join(WORK_DIR, "extended-video.mp4");

  // Use tpad to extend short video to match audio duration
  await execFileAsync("ffmpeg", [
    "-y", "-i", shortVideo,
    "-vf", `tpad=stop=-1:stop_mode=clone:stop_duration=${audioDuration},trim=duration=${audioDuration},setpts=PTS-STARTPTS`,
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-pix_fmt", "yuv420p", "-an", outputVideo,
  ], { timeout: 15000 });

  const extendedDur = await getVideoDuration(outputVideo);
  console.log(`  Extended video duration: ${extendedDur.toFixed(2)}s (target: ${audioDuration}s)`);

  const diff = Math.abs(extendedDur - audioDuration);
  if (diff < 0.5) {
    console.log("  PASS: tpad+trim correctly extends short video to match audio");
  } else {
    console.log(`  FAIL: Duration mismatch: ${diff.toFixed(2)}s off`);
  }
}

async function test3_SubtitleSyncWithActualAudio() {
  console.log("\n--- Test 3: Subtitle Sync with Actual Audio ---");

  const text = "中国教了日本1000年，为什么最后日本反过来打中国？公元663年，白江口。唐军约170艘战船，面对倭国数倍于己的水军。一天之内，四战皆捷，焚其舟四百艘，倭军几乎全军覆没。";
  const audioFile = join(WORK_DIR, "test-subtitle-tts.mp3");

  const ttsOk = await generateTTS(text, "zh-CN-YunxiNeural", audioFile);
  let audioDuration;

  if (ttsOk) {
    audioDuration = await getAudioDuration(audioFile);
    console.log(`  Actual TTS duration: ${audioDuration.toFixed(2)}s`);
  } else {
    // Fallback: simulate a realistic TTS duration
    audioDuration = 15.5;
    console.log(`  SKIP TTS, using simulated duration: ${audioDuration.toFixed(2)}s`);
  }

  const chunks = generateSubtitleChunks(text, audioDuration);

  console.log(`  Generated ${chunks.length} subtitle chunks:`);
  for (const chunk of chunks) {
    console.log(`    [${chunk.startTime.toFixed(2)}s - ${chunk.endTime.toFixed(2)}s] "${chunk.text.substring(0, 30)}..."`);
  }

  // Verify: all chunks should be within [0, audioDuration]
  let allInRange = true;
  for (const chunk of chunks) {
    if (chunk.startTime < 0 || chunk.endTime > audioDuration + 0.1) {
      console.log(`  FAIL: Chunk out of range: [${chunk.startTime}, ${chunk.endTime}] vs [0, ${audioDuration}]`);
      allInRange = false;
    }
  }

  if (allInRange) {
    console.log("  PASS: All subtitle chunks within audio duration range");
  }

  // Verify: last chunk should end at audioDuration
  const lastChunk = chunks[chunks.length - 1];
  if (lastChunk && Math.abs(lastChunk.endTime - audioDuration) < 0.1) {
    console.log("  PASS: Last subtitle chunk ends at audio duration");
  } else {
    console.log(`  FAIL: Last chunk ends at ${lastChunk?.endTime}, expected ${audioDuration}`);
  }
}

async function test4_PlaceholderVideoDuration() {
  console.log("\n--- Test 4: Placeholder Video Duration (60s) ---");

  const placeholderFile = join(WORK_DIR, "placeholder.mp4");
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i",
    `color=c=0x1a1a2e:s=1920x1080:d=60,drawtext=fontfile='C\\:/Windows/Fonts/msyh.ttc':fontsize=48:fontcolor=white@0.6:x=(w-text_w)/2:y=(h/2):text='Test Placeholder'`,
    "-c:v", "libx264", "-t", "60", "-pix_fmt", "yuv420p",
    "-an", placeholderFile,
  ], { timeout: 15000 });

  const dur = await getVideoDuration(placeholderFile);
  console.log(`  Placeholder duration: ${dur.toFixed(2)}s`);

  if (dur >= 55) {
    console.log("  PASS: Placeholder video is long enough for typical TTS");
  } else {
    console.log("  FAIL: Placeholder video too short");
  }
}

async function test5_FullComposeWithShortVideo() {
  console.log("\n--- Test 5: Full Compose with Short Video + TTS Audio ---");

  // Create short video (3s)
  const videoFile = join(WORK_DIR, "compose-video.mp4");
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i",
    `color=c=0x445566:s=1920x1080:d=3,drawtext=fontfile='C\\:/Windows/Fonts/msyh.ttc':fontsize=36:fontcolor=white:text='Scene 1':x=(w-text_w)/2:y=(h-text_h)/2`,
    "-c:v", "libx264", "-t", "3", "-pix_fmt", "yuv420p",
    "-an", videoFile,
  ], { timeout: 15000 });

  // Generate TTS audio
  const text = "这是测试音频，用于验证视频和音频的同步。";
  const audioFile = join(WORK_DIR, "compose-audio.mp3");
  const ttsOk = await generateTTS(text, "zh-CN-YunxiNeural", audioFile);

  let audioDuration;
  if (ttsOk) {
    audioDuration = await getAudioDuration(audioFile);
  } else {
    // Create a 5s silent audio
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-t", "5", "-c:a", "libmp3lame", "-b:a", "128k", audioFile,
    ], { timeout: 10000 });
    audioDuration = 5;
  }

  console.log(`  Video: 3s, Audio: ${audioDuration.toFixed(2)}s`);

  // Compose: tpad+trim video to match audio, add subtitles
  const subtitleChunks = generateSubtitleChunks(text, audioDuration);
  const fontPath = "C\\:/Windows/Fonts/msyh.ttc";
  const fontSize = 36;
  const bottomMargin = Math.round(1080 * 0.06);
  const boxPadding = Math.round(fontSize * 0.3);
  const estimatedTextHeight = fontSize * 4 + 12;
  const yPos = `h-${bottomMargin + estimatedTextHeight}`;

  const drawtextBase = [
    `fontfile='${fontPath}'`,
    `fontsize=${fontSize}`,
    "fontcolor=white@0.95",
    "borderw=2",
    "bordercolor=black@0.7",
    "x=(w-text_w)/2",
    `y=${yPos}`,
    "box=1",
    "boxcolor=black@0.45",
    `boxborderw=${boxPadding}`,
  ].join(":");

  const audioDurStr = audioDuration.toFixed(3);
  const videoFilter = `[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,tpad=stop=-1:stop_mode=clone:stop_duration=${audioDurStr},trim=duration=${audioDurStr},setpts=PTS-STARTPTS[0:v_scaled]`;
  const audioFilter = `[1:a]volume=2.0,aresample=44100,atrim=0:${audioDurStr},asetpts=PTS-STARTPTS[a0]`;

  // Chain: video → scale+tpad → subtitles (start from tpad output)
  const subFilters = [];
  let prevLabel = "0:v_scaled";
  for (let i = 0; i < subtitleChunks.length; i++) {
    const chunk = subtitleChunks[i];
    const isLast = i === subtitleChunks.length - 1;
    const outLabel = isLast ? "vsub" : `s${i}`;
    const escapedText = chunk.text.replace(/'/g, "'\\''").replace(/:/g, "\\:");
    subFilters.push(
      `[${prevLabel}]drawtext=${drawtextBase}:text='${escapedText}':enable='between(t\\,${chunk.startTime}\\,${chunk.endTime})' [${outLabel}]`
    );
    prevLabel = outLabel;
  }

  // Chain: video → scale+tpad → subtitles
  const filterParts = [videoFilter, audioFilter, ...subFilters];
  const finalVideoLabel = prevLabel;

  const outputFile = join(WORK_DIR, "test-output.mp4");
  await execFileAsync("ffmpeg", [
    "-y", "-i", videoFile, "-i", audioFile,
    "-filter_complex", filterParts.join(";"),
    "-map", `[${finalVideoLabel}]`, "-map", "[a0]",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "192k",
    "-r", "30",
    outputFile,
  ], { timeout: 30000 });

  const outputDur = await getVideoDuration(outputFile);
  console.log(`  Output duration: ${outputDur.toFixed(2)}s (expected: ${audioDuration.toFixed(2)}s)`);

  // Verify output file size
  const stat = await import("fs/promises").then(m => m.stat(outputFile));
  console.log(`  Output size: ${(stat.size / 1024).toFixed(0)}KB`);

  const diff = Math.abs(outputDur - audioDuration);
  if (diff < 0.5) {
    console.log("  PASS: Output video duration matches audio duration");
  } else {
    console.log(`  FAIL: Duration mismatch: ${diff.toFixed(2)}s off`);
  }
}

// ==================== Helpers ====================

async function generateTTS(text, voice, outputFile) {
  try {
    await execAsync(
      `python -m edge_tts --voice "${voice}" --rate "+0%" --text "${text.replace(/"/g, '\\"')}" --write-media "${outputFile}"`,
      { timeout: 30000, maxBuffer: 1024 * 1024 }
    );
    const stat = await import("fs/promises").then(m => m.stat(outputFile));
    return stat.size > 100;
  } catch {
    return false;
  }
}

// ==================== Main ====================

async function main() {
  console.log("=== Pipeline Unit Tests ===");
  console.log(`Work dir: ${WORK_DIR}`);

  await mkdir(WORK_DIR, { recursive: true });

  try {
    await test1_TTSDurationVerification();
    await test2_VideoTpadTrim();
    await test3_SubtitleSyncWithActualAudio();
    await test4_PlaceholderVideoDuration();
    await test5_FullComposeWithShortVideo();
  } finally {
    // Cleanup
    try { await rm(WORK_DIR, { recursive: true, force: true }); } catch {}
  }

  console.log("\n=== All tests completed ===");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
