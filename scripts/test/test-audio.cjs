// Standalone test: generate TTS audio + compose video + verify sound
const { execFile } = require("child_process");
const { promisify } = require("util");
const { randomUUID } = require("crypto");
const { mkdir, readFile } = require("fs/promises");
const { tmpdir } = require("os");
const { join } = require("path");

const execFileAsync = promisify(execFile);
const texts = [
  "人工智能正在改变我们的世界，从手机助手到自动驾驶。",
  "深度学习让计算机能够从海量数据中学习规律。",
  "未来，AI将成为每个人的智能助手和创新工具。",
];

(async () => {
  const workDir = join(tmpdir(), "audio-test-" + randomUUID().slice(0, 8));
  const outputDir = join(__dirname, "..", "uploads", "test");
  await mkdir(workDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });

  // Step 1: Generate TTS for each text
  console.log("=== TTS生成 ===");
  const audioFiles = [];
  for (let i = 0; i < texts.length; i++) {
    const audioFile = join(workDir, `tts-${i}.mp3`);
    console.log(`Scene ${i}: "${texts[i].substring(0, 20)}..."`);
    try {
      await execFileAsync("python", [
        "-m", "edge_tts", "--voice", "zh-CN-YunxiNeural",
        "--text", texts[i], "--write-media", audioFile,
      ], { timeout: 30000 });
      const stat = await require("fs/promises").stat(audioFile);
      console.log(`  -> OK, ${stat.size} bytes`);
      audioFiles.push(audioFile);
    } catch (e) {
      console.error(`  -> FAILED: ${e.message}`);
      // Silent fallback
      await execFileAsync("ffmpeg", [
        "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-t", "3", "-c:a", "libmp3lame", "-b:a", "128k", audioFile,
      ]);
      audioFiles.push(audioFile);
    }
  }

  // Step 2: Get audio durations
  console.log("\n=== 音频时长 ===");
  let totalDuration = 0;
  for (let i = 0; i < audioFiles.length; i++) {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", audioFiles[i],
    ]);
    const dur = parseFloat(stdout.trim());
    console.log(`Scene ${i}: ${dur.toFixed(1)}s`);
    totalDuration += dur;
  }
  console.log(`总时长: ${totalDuration.toFixed(1)}s`);

  // Step 3: Compose video with audio
  console.log("\n=== 合成视频 ===");
  const outputPath = join(outputDir, "test-output.mp4");
  const inputArgs = [];
  const filterParts = [];
  const concatInputs = [];
  const FONT = "C\\:/Windows/Fonts/msyh.ttc";

  for (let i = 0; i < audioFiles.length; i++) {
    // Generate a colored placeholder video for each scene
    const colors = ["red", "blue", "green"];
    const videoFile = join(workDir, `scene-${i}.mp4`);
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi",
      "-i", `color=c=${colors[i]}:s=1920x1080:d=${totalDuration / texts.length}`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", videoFile,
    ]);

    inputArgs.push("-i", videoFile, "-i", audioFiles[i]);
    const vi = i * 2;
    const ai = i * 2 + 1;

    // Scale video
    filterParts.push(`[${vi}:v]scale=1920:1080,setsar=1[v${i}]`);

    // Get actual audio duration for this scene
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", audioFiles[i],
    ]);
    const audioDur = parseFloat(stdout.trim());

    // Audio normalize + trim
    filterParts.push(`[${ai}:a]volume=2.0,aresample=44100,atrim=0:${audioDur}[a${i}]`);

    // Subtitle
    const escaped = texts[i].replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/%/g, "\\%");
    filterParts.push(
      `[v${i}]drawtext=fontfile='${FONT}':fontsize=48:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-text_h-80:box=1:boxcolor=black@0.5:boxborderw=10:text='${escaped}':enable='between(t,0,${audioDur})'[v${i}sub]`
    );

    concatInputs.push(`[v${i}sub][a${i}]`);
  }

  filterParts.push(`${concatInputs.join("")}concat=n=${texts.length}:v=1:a=1[outv][outa]`);

  await execFileAsync("ffmpeg", [
    "-y", ...inputArgs,
    "-filter_complex", filterParts.join(";"),
    "-map", "[outv]", "-map", "[outa]",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "192k",
    outputPath,
  ], { timeout: 120000 });

  // Step 4: Verify output
  console.log("\n=== 验证输出 ===");
  const { stdout: probeOut } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "stream=codec_type,codec_name,duration",
    "-of", "json", outputPath,
  ]);
  const info = JSON.parse(probeOut);
  const hasAudio = info.streams.some(s => s.codec_type === "audio");
  const hasVideo = info.streams.some(s => s.codec_type === "video");
  console.log(`视频流: ${hasVideo ? "✅" : "❌"}`);
  console.log(`音频流: ${hasAudio ? "✅" : "❌"}`);
  
  if (hasAudio) {
    const audioStream = info.streams.find(s => s.codec_type === "audio");
    console.log(`音频编码: ${audioStream.codec_name}`);
    console.log(`音频时长: ${audioStream.duration || "N/A"}`);
  }

  const { size } = await require("fs/promises").stat(outputPath);
  console.log(`文件大小: ${(size / 1024 / 1024).toFixed(1)} MB`);
  console.log(`输出路径: ${outputPath}`);
})();
