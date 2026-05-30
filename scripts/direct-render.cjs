// Directly create project + storyboard + scenes + render
const { execFile } = require("child_process");
const { promisify } = require("util");
const { readFile, writeFile, mkdir } = require("fs/promises");
const { join } = require("path");
const { randomUUID } = require("crypto");
const { tmpdir } = require("os");
const execFileAsync = promisify(execFile);

require("dotenv").config();

// Dynamic import since Prisma client is ESM
(async () => {
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL || "file:./dev.db" });
  const prisma = new PrismaClient({ adapter });

  const USER_ID = "cmp3v2aqa0000k8ulak8r79d5";
  const FONT = "C\\:/Windows/Fonts/msyh.ttc";

  const texts = [
    "人工智能正在改变我们的世界，从手机助手到自动驾驶。",
    "深度学习让计算机能够从海量数据中学习规律。",
    "未来，AI将成为每个人的智能助手和创新工具。",
  ];

  // Create project
  const project = await prisma.project.create({
    data: {
      name: "直接渲染测试",
      sourceText: texts.join(""),
      aspectRatio: "W_16_9",
      contentStyle: "KNOWLEDGE",
      userId: USER_ID,
      status: "STORYBOARD_READY",
      storyboard: {
        create: {
          status: "CONFIRMED",
          totalScenes: texts.length,
          totalDuration: texts.length * 5,
          scenes: {
            create: texts.map((t, i) => ({
              sceneNumber: i + 1,
              voiceoverText: t,
              visualDesc: "科技场景",
              materialQuery: "technology AI",
            })),
          },
        },
      },
    },
    include: { storyboard: { include: { scenes: { orderBy: { sceneNumber: "asc" } } } } },
  });

  console.log("Project:", project.id);

  const scenes = project.storyboard.scenes;
  const config = { width: 1920, height: 1080, fps: 30, format: "mp4" };
  const workDir = join(tmpdir(), "render-" + randomUUID().slice(0, 8));
  await mkdir(workDir, { recursive: true });

  // Create render job
  const renderJob = await prisma.renderJob.create({
    data: { projectId: project.id, userId: USER_ID, status: "PREPARING", config: JSON.stringify(config), startedAt: new Date() },
  });

  await prisma.project.update({ where: { id: project.id }, data: { status: "RENDERING" } });

  // TTS stage
  console.log("=== TTS生成 ===");
  for (let i = 0; i < scenes.length; i++) {
    const audioFile = join(workDir, `tts-${i}.mp3`);
    console.log(`Scene ${i}: "${texts[i].substring(0, 20)}..."`);
    try {
      await execFileAsync("python", [
        "-m", "edge_tts", "--voice", "zh-CN-YunxiNeural",
        "--text", texts[i], "--write-media", audioFile,
      ], { timeout: 30000 });
      const { stdout } = await execFileAsync("ffprobe", [
        "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", audioFile,
      ]);
      const dur = parseFloat(stdout.trim());
      console.log(`  -> ${dur.toFixed(1)}s`);
      await prisma.scene.update({ where: { id: scenes[i].id }, data: { audioUrl: audioFile, audioDuration: dur } });
    } catch (e) {
      console.error(`  -> FAILED: ${e.message}`);
      await execFileAsync("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "3", "-c:a", "libmp3lame", audioFile]);
    }
  }

  // Black placeholders (60s each, will be trimmed)
  console.log("\n=== 占位视频 ===");
  for (let i = 0; i < scenes.length; i++) {
    const materialFile = join(workDir, `scene-${i}.mp4`);
    await execFileAsync("ffmpeg", ["-y", "-f", "lavfi", "-i", `color=c=black:s=${config.width}x${config.height}:d=60`, "-c:v", "libx264", "-t", "60", "-pix_fmt", "yuv420p", "-an", materialFile]);
    console.log(`Scene ${i}: black 60s`);
  }

  // Compose
  console.log("\n=== 合成 ===");
  const outputDir = join(process.cwd(), "uploads", project.id, "output");
  await mkdir(outputDir, { recursive: true });
  const outputPath = join(outputDir, `${randomUUID()}.mp4`);

  const inputArgs = [];
  const filterParts = [];
  const concatInputs = [];

  for (let i = 0; i < scenes.length; i++) {
    const audioFile = join(workDir, `tts-${i}.mp3`);
    const materialFile = join(workDir, `scene-${i}.mp4`);

    // Get actual audio duration
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", audioFile,
    ]);
    const audioDuration = parseFloat(stdout.trim()) || 5;

    inputArgs.push("-i", materialFile, "-i", audioFile);
    const vi = i * 2;
    const ai = i * 2 + 1;

    // Video: scale + trim to audio duration
    filterParts.push(`[${vi}:v]scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,trim=duration=${audioDuration},setpts=PTS-STARTPTS[v${i}]`);

    // Audio: normalize + trim + PTS reset
    filterParts.push(`[${ai}:a]volume=2.0,aresample=44100,atrim=0:${audioDuration},asetpts=PTS-STARTPTS[a${i}]`);

    // Subtitle
    const escaped = texts[i].replace(/\\/g, "\\\\").replace(/'/g, "'\\''").replace(/:/g, "\\:").replace(/%/g, "\\%");
    filterParts.push(`[v${i}]drawtext=fontfile='${FONT}':fontsize=54:fontcolor=white:borderw=3:bordercolor=black:shadowcolor=black:shadowx=2:shadowy=2:x=(w-text_w)/2:y=h-text_h-92:box=1:boxcolor=black@0.5:boxborderw=10:text='${escaped}':enable='between(t,0,${audioDuration})'[v${i}sub]`);

    concatInputs.push(`[v${i}sub][a${i}]`);
  }

  filterParts.push(`${concatInputs.join("")}concat=n=${scenes.length}:v=1:a=1[outv][outa]`);

  await execFileAsync("ffmpeg", [
    "-y", ...inputArgs,
    "-filter_complex", filterParts.join(";"),
    "-map", "[outv]", "-map", "[outa]",
    "-c:v", "libx264", "-preset", "fast", "-crf", "23",
    "-c:a", "aac", "-b:a", "192k",
    "-r", "30", "-movflags", "+faststart",
    outputPath,
  ], { timeout: 120000 });

  // Verify
  const { stdout: probe } = await execFileAsync("ffprobe", [
    "-v", "error", "-show_entries", "stream=codec_type,codec_name,duration",
    "-of", "json", outputPath,
  ]);
  const info = JSON.parse(probe);
  const audio = info.streams.find(s => s.codec_type === "audio");
  const video = info.streams.find(s => s.codec_type === "video");

  console.log("\n=== 验证 ===");
  console.log("视频:", video ? "✅" : "❌", video?.duration?.toFixed(1) + "s");
  console.log("音频:", audio ? "✅" : "❌", audio?.codec_name, audio?.duration?.toFixed(1) + "s");
  console.log("输出:", outputPath);

  // Update DB
  const buf = await readFile(outputPath);
  await prisma.renderJob.update({
    where: { id: renderJob.id },
    data: { status: "COMPLETED", outputUrl: `/api/uploads/${project.id}/output/${outputPath.split("\\").pop()}`, outputFormat: "mp4", outputSize: buf.length, completedAt: new Date(), progress: 100 },
  });
  await prisma.project.update({ where: { id: project.id }, data: { status: "COMPLETED" } });

  await prisma.$disconnect();
  console.log("DONE");
})();
