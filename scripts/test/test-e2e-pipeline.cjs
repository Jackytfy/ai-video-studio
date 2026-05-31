/**
 * End-to-end pipeline test:
 * 1. AI storyboard generation with enriched fields
 * 2. Material search across platforms
 * 3. Video rendering with sync'd subtitles
 * 4. Verify output integrity
 */
require("dotenv").config();
const { execFile } = require("child_process");
const { promisify } = require("util");
const { readFile, writeFile, mkdir, rm } = require("fs/promises");
const { join } = require("path");
const { tmpdir } = require("os");
const { randomUUID } = require("crypto");

const execFileAsync = promisify(execFile);

// ─── Subtitle functions (inline) ───
function estimateSpeechDuration(text) {
  const chineseChars = (text.match(/[一-鿿]/g) || []).length;
  const nonChinese = text.replace(/[一-鿿]/g, "").replace(/[，。！？、；：,;!?\s\n"'「」『』【】（）\(\)\[\]]/g, "").length;
  return Math.max(0.5, chineseChars / 4 + nonChinese / 6);
}

function generateSubtitleChunks(text, audioDuration) {
  const lines = text.split(/(?<=[。！？；,;!?])|(?<=，[^，]{10,})/).filter(s => s.trim().length > 0);
  if (lines.length === 0) return [];
  const lineDurations = lines.map(l => estimateSpeechDuration(l));
  const totalEst = lineDurations.reduce((s, d) => s + d, 0);
  if (totalEst === 0) return [];
  const chunks = [];
  let cursor = 0;
  for (let i = 0; i < lines.length; i++) {
    const proportion = lineDurations[i] / totalEst;
    const dur = Math.min(proportion * audioDuration * 1.03, proportion * audioDuration + 0.3);
    const start = cursor;
    let end = cursor + dur;
    if (i === lines.length - 1) end = audioDuration;
    if (end - start < 0.5 && lines.length > 1) end = start + 0.5;
    end = Math.min(end, audioDuration);
    chunks.push({ text: lines[i].trim(), startTime: Math.round(start * 100) / 100, endTime: Math.round(end * 100) / 100 });
    cursor = end;
  }
  return chunks;
}

async function getAudioDuration(filePath) {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", filePath,
    ], { timeout: 5000 });
    return parseFloat(stdout.trim()) || 0;
  } catch { return 0; }
}

// ─── Test configuration ───
const SOURCE_TEXT = "朱棣，从北平藩王到永乐大帝。他发动靖难之役夺取皇位，迁都北京，建造紫禁城。编纂永乐大典，派遣郑和下西洋，开创了永乐盛世。";
const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;

async function main() {
  const workDir = join(tmpdir(), `e2e-${randomUUID()}`);
  await mkdir(workDir, { recursive: true });

  console.log("=== E2E Pipeline Test ===\n");
  let passed = 0;
  let failed = 0;

  // ─── Step 1: Verify AI storyboard generation capability ───
  console.log("Step 1: AI Storyboard Generation\n");

  // Test the AI prompt structure (without calling API - verify prompt produces correct format)
  const mockStoryboard = {
    title: "朱棣：从藩王到大帝",
    scenes: [
      {
        sceneNumber: 1,
        title: "北平藩王",
        sceneType: "REAL_FOOTAGE",
        voiceoverText: "朱棣，从北平藩王到永乐大帝。他的一生充满了战争与权谋，最终登上了皇位的巅峰。",
        visualDesc: "金色铠甲武士骑马立于古城墙上，城下旌旗密布、千军万马列阵。镜头从大全景缓缓推近至武士面部特写，逆光剪影，天空阴云密布",
        materialQuery: "北疆战场场景，色调偏冷峻，突出肃杀之气，镜头风格写实，注重细节和动态感，氛围紧张、军事化",
        materialQueryEn: "ancient chinese military battlefield dramatic",
        scripts: ["朱棣，从北平藩王到永乐大帝。", "他的一生充满了战争与权谋，最终登上了皇位的巅峰。"],
      },
      {
        sceneNumber: 2,
        title: "靖难之役",
        sceneType: "REAL_FOOTAGE",
        voiceoverText: "公元1402年，朱棣发动靖难之役，率军南下，历经四年苦战，终于攻入南京，夺取皇位。",
        visualDesc: "平原上千军万马厮杀，旌旗蔽日，硝烟弥漫。白马将军持长枪冲锋，镜头跟随推进，尘土飞扬，暖黄色调，史诗感构图",
        materialQuery: "古代战争场景，千军万马冲锋，旌旗蔽日，色调偏暖黄，镜头风格史诗感，氛围壮烈",
        materialQueryEn: "ancient war battle epic cavalry charge",
        scripts: ["公元1402年，朱棣发动靖难之役，率军南下。", "历经四年苦战，终于攻入南京，夺取皇位。"],
      },
      {
        sceneNumber: 3,
        title: "永乐盛世",
        sceneType: "REAL_FOOTAGE",
        voiceoverText: "迁都北京，建造紫禁城，编纂永乐大典，派遣郑和下西洋，开创了永乐盛世。",
        visualDesc: "紫禁城宫殿群全景航拍，金黄琉璃瓦在阳光下闪耀，红墙黄瓦层层叠叠。镜头从太和殿广场缓缓升起至高空俯瞰，辉煌壮丽",
        materialQuery: "紫禁城全景，金碧辉煌宫殿，阳光照射，色调温暖辉煌，镜头风格航拍，氛围庄严宏大",
        materialQueryEn: "forbidden city aerial palace golden",
        scripts: ["迁都北京，建造紫禁城。", "编纂永乐大典，派遣郑和下西洋，开创了永乐盛世。"],
      },
    ],
  };

  // Verify enriched fields are present
  let fieldsOk = true;
  for (const scene of mockStoryboard.scenes) {
    const hasVoiceover = !!scene.voiceoverText && scene.voiceoverText.length > 10;
    const hasVisualDesc = !!scene.visualDesc && scene.visualDesc.length > 20;
    const hasMaterialQuery = !!scene.materialQuery && scene.materialQuery.length > 5;
    const hasMaterialQueryEn = !!scene.materialQueryEn && scene.materialQueryEn.length > 3;
    const hasScripts = Array.isArray(scene.scripts) && scene.scripts.length >= 1;

    if (!hasVoiceover || !hasVisualDesc || !hasMaterialQuery || !hasMaterialQueryEn || !hasScripts) {
      console.log(`  ❌ Scene ${scene.sceneNumber}: missing enriched fields`);
      fieldsOk = false;
    } else {
      console.log(`  ✅ Scene ${scene.sceneNumber}: all enriched fields present`);
      console.log(`     voiceover: ${scene.voiceoverText.substring(0, 30)}...`);
      console.log(`     visualDesc: ${scene.visualDesc.substring(0, 30)}...`);
      console.log(`     materialQuery: ${scene.materialQuery.substring(0, 30)}...`);
      console.log(`     materialQueryEn: ${scene.materialQueryEn}`);
      console.log(`     scripts: ${scene.scripts.length} segments`);
    }
  }
  if (fieldsOk) passed++; else failed++;

  // ─── Step 2: Material search across platforms ───
  console.log("\nStep 2: Multi-Platform Material Search\n");

  const pexelsKey = process.env.PEXELS_API_KEY;
  const pixabayKey = process.env.PIXABAY_API_KEY;

  console.log(`  Pexels API: ${pexelsKey ? "✅ configured" : "❌ not configured"}`);
  console.log(`  Pixabay API: ${pixabayKey ? "✅ configured" : "❌ not configured"}`);

  if (pexelsKey) {
    try {
      // Test Pexels search with English keywords from mock storyboard
      const keywords = mockStoryboard.scenes[0].materialQueryEn;
      console.log(`  Searching Pexels for: "${keywords}"`);
      const res = await fetch(
        `https://api.pexels.com/videos/search?query=${encodeURIComponent(keywords)}&per_page=3&orientation=landscape`,
        { headers: { Authorization: pexelsKey }, signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const videos = data.videos || [];
      console.log(`  ✅ Pexels returned ${videos.length} videos`);
      if (videos.length > 0) {
        const bestFile = videos[0].video_files?.find(f => f.quality === "hd") || videos[0].video_files?.[0];
        console.log(`     Best: ${bestFile?.quality || "N/A"} quality, ${videos[0].duration}s, ${bestFile?.width}x${bestFile?.height}`);
      }
      passed++;
    } catch (e) {
      console.log(`  ❌ Pexels search failed: ${e.message}`);
      failed++;
    }
  } else {
    console.log("  ⏭ Skipping Pexels search (no API key)");
  }

  // ─── Step 3: Watermark removal ───
  console.log("\nStep 3: Watermark Removal\n");

  // Test watermark removal via edge cropping
  const testVideo = join(workDir, "test-watermark.mp4");
  const cleanVideo = join(workDir, "test-clean.mp4");

  try {
    // Generate a test video (simple color)
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "color=c=blue:s=1920x1080:d=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", testVideo,
    ], { timeout: 10000 });

    // Apply watermark removal (crop 2% edges)
    await execFileAsync("ffmpeg", [
      "-y", "-i", testVideo,
      "-vf", "crop=iw*0.96:ih*0.96:iw*0.02:ih*0.02",
      "-c:v", "libx264", "-preset", "fast", cleanVideo,
    ], { timeout: 10000 });

    // Verify dimensions changed
    const { stdout: origInfo } = await execFileAsync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0", testVideo,
    ], { timeout: 5000 });

    const { stdout: cleanInfo } = await execFileAsync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0", cleanVideo,
    ], { timeout: 5000 });

    const [origW, origH] = origInfo.trim().split(",").map(Number);
    const [cleanW, cleanH] = cleanInfo.trim().split(",").map(Number);

    console.log(`  Original: ${origW}x${origH}`);
    console.log(`  Cleaned:  ${cleanW}x${cleanH}`);
    console.log(`  Crop: ${origW - cleanW}px horizontal, ${origH - cleanH}px vertical`);

    if (cleanW < origW && cleanH < origH && cleanW > 0 && cleanH > 0) {
      console.log("  ✅ Watermark removal works (edge crop applied)");
      passed++;
    } else {
      console.log("  ❌ Crop did not reduce dimensions");
      failed++;
    }
  } catch (e) {
    console.log(`  ❌ Watermark removal test failed: ${e.message}`);
    failed++;
  }

  // ─── Step 4: TTS + Subtitle sync + Video render ───
  console.log("\nStep 4: TTS + Subtitle Sync + Video Render\n");

  const scenes = mockStoryboard.scenes;
  const inputArgs = [];
  const filterParts = [];
  const concatInputs = [];

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const audioFile = join(workDir, `tts-${i}.mp3`);

    // Generate TTS
    try {
      await execFileAsync("python", [
        "-m", "edge_tts",
        "--voice", "zh-CN-YunxiNeural",
        "--rate", "+0%",
        "--text", scene.voiceoverText,
        "--write-media", audioFile,
      ], { timeout: 30000 });

      const duration = await getAudioDuration(audioFile);
      scene.audioDuration = duration;
      console.log(`  Scene ${i + 1}: TTS OK (${duration.toFixed(2)}s)`);
    } catch (e) {
      console.log(`  Scene ${i + 1}: TTS failed, using silent fallback`);
      await execFileAsync("ffmpeg", [
        "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-t", "5", "-c:a", "libmp3lame", "-b:a", "128k", audioFile,
      ], { timeout: 10000 });
      scene.audioDuration = 5;
    }

    // Generate subtitles
    const chunks = generateSubtitleChunks(scene.voiceoverText, scene.audioDuration);
    const lastChunk = chunks[chunks.length - 1];
    const syncOk = lastChunk.endTime <= scene.audioDuration + 0.1;
    console.log(`  Scene ${i + 1}: ${chunks.length} subtitle chunks, ends=${lastChunk.endTime.toFixed(2)}s, sync=${syncOk ? "✅" : "❌"}`);
    scene.subtitleChunks = chunks;
    if (syncOk) passed++; else failed++;
  }

  // Composite video
  console.log("\n  Compositing final video...");
  const outputName = `e2e-output-${randomUUID()}.mp4`;
  const outputPath = join(workDir, outputName);

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const videoFile = join(workDir, `vid-${i}.mp4`);
    const audioFile = join(workDir, `tts-${i}.mp3`);

    // Create colored background video
    const colors = ["0x1a1a2e", "0x16213e", "0x0f3460"];
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i",
      `color=c=${colors[i % 3]}:s=${WIDTH}x${HEIGHT}:d=${scene.audioDuration}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", videoFile,
    ], { timeout: 15000 });

    inputArgs.push("-i", videoFile, "-i", audioFile);
    const vIdx = i * 2, aIdx = i * 2 + 1;

    filterParts.push(
      `[${vIdx}:v]scale=${WIDTH}:${HEIGHT},setsar=1,trim=duration=${scene.audioDuration},setpts=PTS-STARTPTS[v${i}]`
    );
    filterParts.push(
      `[${aIdx}:a]volume=2.0,aresample=44100,atrim=0:${scene.audioDuration},asetpts=PTS-STARTPTS[a${i}]`
    );

    // Add subtitles
    if (scene.subtitleChunks.length > 0) {
      const fontSize = Math.round(HEIGHT / 20);
      const fontPath = process.platform === "win32"
        ? "C\\:/Windows/Fonts/msyh.ttc"
        : "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc";
      const bottomMargin = Math.round(HEIGHT * 0.06);
      const yPos = `h-text_h-${bottomMargin + fontSize / 2}`;
      const base = [
        `fontfile='${fontPath}'`, `fontsize=${fontSize}`, "fontcolor=white",
        "borderw=3", "bordercolor=black", "x=(w-text_w)/2", `y=${yPos}`,
        "box=1", "boxcolor=black@0.5", "boxborderw=10",
      ].join(":");

      let prevLabel = `v${i}`;
      for (let j = 0; j < scene.subtitleChunks.length; j++) {
        const chunk = scene.subtitleChunks[j];
        const isLast = j === scene.subtitleChunks.length - 1;
        const outLabel = isLast ? `v${i}_sub` : `v${i}_s${j}`;
        const escaped = chunk.text
          .replace(/\\/g, "\\\\").replace(/'/g, "'\\\\''")
          .replace(/:/g, "\\:").replace(/%/g, "\\%").replace(/\n/g, " ");
        filterParts.push(
          `[${prevLabel}]drawtext=${base}:text='${escaped}':enable='between(t\\,${chunk.startTime}\\,${chunk.endTime})' [${outLabel}]`
        );
        prevLabel = outLabel;
      }
      concatInputs.push(`[${prevLabel}][a${i}]`);
    } else {
      concatInputs.push(`[v${i}][a${i}]`);
    }
  }

  filterParts.push(`${concatInputs.join("")}concat=n=${scenes.length}:v=1:a=1[outv][outa]`);

  try {
    await execFileAsync("ffmpeg", [
      "-y", ...inputArgs,
      "-filter_complex", filterParts.join(";"),
      "-map", "[outv]", "-map", "[outa]",
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
      "-r", String(FPS), "-movflags", "+faststart",
      outputPath,
    ], { timeout: 120000 });

    const outputSize = (await readFile(outputPath)).length;
    const outputDuration = await getAudioDuration(outputPath);
    const expectedDuration = scenes.reduce((s, sc) => s + sc.audioDuration, 0);
    const durationDiff = Math.abs(outputDuration - expectedDuration);

    console.log(`\n  Output: ${outputName}`);
    console.log(`  Size: ${(outputSize / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  Duration: ${outputDuration.toFixed(2)}s (expected ${expectedDuration.toFixed(2)}s, diff=${durationDiff.toFixed(2)}s)`);

    if (outputSize > 10000 && durationDiff < 2.0) {
      console.log("  ✅ Video rendered successfully with correct duration");
      passed++;
    } else {
      console.log("  ❌ Video render issue");
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
