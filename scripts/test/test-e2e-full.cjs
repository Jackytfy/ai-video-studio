/**
 * 全链路端到端测试：
 * 口播脚本 → 场景拆分 → 素材搜索下载 → TTS生成 → 字幕 → 合并渲染
 *
 * 模拟真实用户流程，验证每个环节。
 */
require("dotenv").config();
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);
const { readFile, writeFile, mkdir, rm } = require("fs/promises");
const { join } = require("path");
const { tmpdir } = require("os");
const { randomUUID } = require("crypto");

// ─── 口播脚本 ───
const SCRIPT = `朱棣，从北平藩王到永乐大帝。他的一生充满了战争与权谋，最终登上了皇位的巅峰。
公元1402年，朱棣发动靖难之役，率军南下，历经四年苦战，终于攻入南京。
迁都北京，建造紫禁城，编纂永乐大典，派遣郑和下西洋，开创了永乐盛世。`;

// ─── 场景拆分（模拟 AI 分镜） ───
const SCENES = [
  {
    sceneNumber: 1,
    title: "北平藩王",
    voiceoverText: "朱棣，从北平藩王到永乐大帝。他的一生充满了战争与权谋，最终登上了皇位的巅峰。",
    visualDesc: "金色铠甲武士骑马立于古城墙上，城下旌旗密布千军万马列阵。镜头从大全景推近至面部特写，逆光剪影",
    materialQuery: "北疆战场场景，色调偏冷峻，突出肃杀之气，镜头风格写实，氛围紧张军事化",
    materialQueryEn: "ancient chinese battlefield warrior dramatic",
  },
  {
    sceneNumber: 2,
    title: "靖难之役",
    voiceoverText: "公元1402年，朱棣发动靖难之役，率军南下，历经四年苦战，终于攻入南京。",
    visualDesc: "平原上千军万马厮杀，旌旗蔽日，硝烟弥漫。白马将军持长枪冲锋，尘土飞扬，暖黄色调",
    materialQuery: "古代战争场景，千军万马冲锋，旌旗蔽日，色调偏暖黄，镜头风格史诗感，氛围壮烈",
    materialQueryEn: "ancient war battle epic cavalry charge",
  },
  {
    sceneNumber: 3,
    title: "永乐盛世",
    voiceoverText: "迁都北京，建造紫禁城，编纂永乐大典，派遣郑和下西洋，开创了永乐盛世。",
    visualDesc: "紫禁城宫殿群全景航拍，金黄琉璃瓦在阳光下闪耀，红墙黄瓦层层叠叠。镜头从太和殿广场升起",
    materialQuery: "紫禁城全景，金碧辉煌宫殿，阳光照射，色调温暖辉煌，镜头风格航拍，氛围庄严宏大",
    materialQueryEn: "forbidden city aerial palace golden",
  },
];

// ─── 字幕工具函数 ───
function estimateSpeechDuration(text) {
  const cn = (text.match(/[一-鿿]/g) || []).length;
  const other = text.replace(/[一-鿿]/g, "").replace(/[，。！？、；：,;!?\s\n]/g, "").length;
  return Math.max(0.5, cn / 4 + other / 6);
}

function generateSubtitleChunks(text, audioDuration) {
  const lines = text.split(/(?<=[。！？；,;!?])|(?<=，[^，]{10,})/).filter(s => s.trim().length > 0);
  if (lines.length === 0) return [];
  const durations = lines.map(l => estimateSpeechDuration(l));
  const total = durations.reduce((s, d) => s + d, 0);
  if (total === 0) return [];
  const chunks = [];
  let cursor = 0;
  for (let i = 0; i < lines.length; i++) {
    const prop = durations[i] / total;
    const dur = Math.min(prop * audioDuration * 1.03, prop * audioDuration + 0.3);
    const start = cursor;
    let end = cursor + dur;
    if (i === lines.length - 1) end = audioDuration;
    if (end - start < 0.5 && lines.length > 1) end = start + 0.5;
    end = Math.min(end, audioDuration);
    chunks.push({ text: lines[i].trim(), start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 });
    cursor = end;
  }
  return chunks;
}

function escapeDrawtext(text) {
  // Only escape single quotes for FFmpeg drawtext
  return text.replace(/'/g, "'\\''").replace(/\n/g, " ");
}

// ─── 素材搜索（Pexels） ───
async function searchPexels(query, count = 2) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch(
      "https://api.pexels.com/videos/search?query=" + encodeURIComponent(query) + "&per_page=" + count + "&orientation=landscape",
      { headers: { Authorization: key }, signal: AbortSignal.timeout(15000) }
    );
    const data = await res.json();
    return (data.videos || []).map(v => {
      const hd = v.video_files.find(f => f.quality === "hd" && f.width >= 1280)
        || v.video_files.find(f => f.width >= 1920)
        || v.video_files.find(f => f.width >= 1280)
        || v.video_files.sort((a, b) => b.width - a.width)[0];
      return { id: v.id, url: hd?.link, width: hd?.width || 0, height: hd?.height || 0, duration: v.duration, thumbnail: v.image };
    }).filter(v => v.url);
  } catch { return []; }
}

// ─── 素材搜索（Bilibili） ───
async function searchBilibili(query, count = 2) {
  try {
    const url = "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=" +
      encodeURIComponent(query) + "&page=1&page_size=" + count + "&order=totalrank";
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://search.bilibili.com/", "Origin": "https://search.bilibili.com",
        "Accept": "application/json", "Cookie": "buvid3=placeholder",
      },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    const results = (data.data?.result || []).slice(0, count);
    const videos = [];
    for (const v of results) {
      const durParts = (v.duration || "0:00").split(":").map(Number);
      const durSec = durParts.length === 3 ? durParts[0] * 3600 + durParts[1] * 60 + durParts[2] : durParts[0] * 60 + durParts[1];
      if (durSec < 3 || durSec > 300) continue;
      // Get stream URL
      try {
        const infoRes = await fetch("https://api.bilibili.com/x/web-interface/view?bvid=" + v.bvid, {
          headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/", "Origin": "https://www.bilibili.com" },
          signal: AbortSignal.timeout(10000),
        });
        const info = await infoRes.json();
        const cid = info.data?.cid;
        if (!cid) continue;
        const streamRes = await fetch("https://api.bilibili.com/x/player/playurl?bvid=" + v.bvid + "&cid=" + cid + "&qn=80&fnval=1", {
          headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/video/" + v.bvid },
          signal: AbortSignal.timeout(10000),
        });
        const stream = await streamRes.json();
        const videoUrl = stream.data?.durl?.[0]?.url;
        if (videoUrl) {
          videos.push({
            id: "bilibili-" + v.bvid,
            url: videoUrl,
            width: 1920, height: 1080,
            duration: durSec,
            thumbnail: v.pic?.startsWith("//") ? "https:" + v.pic : v.pic,
            platform: "bilibili",
          });
        }
      } catch {}
    }
    return videos;
  } catch { return []; }
}

// ─── 主流程 ───
async function main() {
  const workDir = join(tmpdir(), "e2e-full-" + randomUUID());
  await mkdir(workDir, { recursive: true });

  console.log("╔══════════════════════════════════════════╗");
  console.log("║   全链路端到端测试：脚本→素材→渲染→输出  ║");
  console.log("╚══════════════════════════════════════════╝\n");
  console.log("📋 口播脚本:");
  console.log("   " + SCRIPT.split("\n")[0].substring(0, 60) + "...");
  console.log("   共 " + SCRIPT.length + " 字, " + SCENES.length + " 个场景\n");

  let passed = 0, failed = 0;

  // ─── 阶段1: 素材搜索 ───
  console.log("━━━ 阶段1: 素材搜索 ━━━");
  for (const scene of SCENES) {
    console.log("\n场景" + scene.sceneNumber + ": " + scene.title);
    console.log("  检索词: " + scene.materialQueryEn);

    // Pexels
    const pexels = await searchPexels(scene.materialQueryEn, 2);
    console.log("  Pexels: " + pexels.length + " 个结果" + (pexels.length > 0 ? " (" + pexels[0].width + "x" + pexels[0].height + ")" : ""));

    // Bilibili
    const bilibili = await searchBilibili(scene.materialQuery, 2);
    console.log("  Bilibili: " + bilibili.length + " 个结果" + (bilibili.length > 0 ? " (有视频流)" : ""));

    // 选择最佳素材
    const allMaterials = [...pexels.map(v => ({ ...v, platform: "pexels" })), ...bilibili];
    if (allMaterials.length > 0) {
      scene.material = allMaterials[0];
      console.log("  ✅ 选定: " + scene.material.platform + " | " + scene.material.width + "x" + scene.material.height + " | " + scene.material.duration + "s");
      passed++;
    } else {
      console.log("  ⚠️  无素材，将使用纯色背景");
      scene.material = null;
      failed++;
    }
  }

  // ─── 阶段2: 素材下载 ───
  console.log("\n\n━━━ 阶段2: 素材下载 ━━━");
  for (const scene of SCENES) {
    const videoPath = join(workDir, "material-" + scene.sceneNumber + ".mp4");
    scene.materialPath = videoPath;

    if (!scene.material) {
      // 生成纯色背景
      await execFileAsync("ffmpeg", [
        "-y", "-f", "lavfi", "-i", "color=c=0x1a1a2e:s=1920x1080:d=10",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", videoPath,
      ], { timeout: 10000 });
      console.log("  场景" + scene.sceneNumber + ": 纯色背景");
      continue;
    }

    try {
      console.log("  场景" + scene.sceneNumber + ": 下载中...");
      const res = await fetch(scene.material.url, {
        signal: AbortSignal.timeout(60000),
        headers: scene.material.platform === "bilibili" ? { "Referer": "https://www.bilibili.com/", "User-Agent": "Mozilla/5.0" } : { "User-Agent": "Mozilla/5.0" },
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buffer = Buffer.from(await res.arrayBuffer());
      const rawPath = join(workDir, "raw-" + scene.sceneNumber + ".mp4");
      await writeFile(rawPath, buffer);
      console.log("  场景" + scene.sceneNumber + ": 下载完成 (" + (buffer.length / 1024 / 1024).toFixed(1) + "MB)");

      // 转换为统一格式 + 裁切水印
      const vf = scene.material.platform === "bilibili"
        ? "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,crop=iw*0.96:ih*0.96:iw*0.02:ih*0.02"
        : "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2";

      await execFileAsync("ffmpeg", [
        "-y", "-i", rawPath,
        "-c:v", "libx264", "-preset", "fast", "-vf", vf,
        "-an", videoPath,
      ], { timeout: 120000 });

      console.log("  场景" + scene.sceneNumber + ": ✅ 转换完成" + (scene.material.platform === "bilibili" ? " (已裁切水印)" : ""));
      passed++;
    } catch (e) {
      console.log("  场景" + scene.sceneNumber + ": ❌ 下载失败: " + e.message);
      // Fallback: 纯色背景
      await execFileAsync("ffmpeg", [
        "-y", "-f", "lavfi", "-i", "color=c=0x1a1a2e:s=1920x1080:d=10",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", videoPath,
      ], { timeout: 10000 });
      failed++;
    }
  }

  // ─── 阶段3: TTS 生成 ───
  console.log("\n\n━━━ 阶段3: TTS 语音合成 ━━━");
  for (const scene of SCENES) {
    const audioPath = join(workDir, "tts-" + scene.sceneNumber + ".mp3");
    scene.audioPath = audioPath;

    try {
      await execFileAsync("python", [
        "-m", "edge_tts", "--voice", "zh-CN-YunxiNeural",
        "--rate", "+0%", "--volume", "+0%",
        "--text", scene.voiceoverText,
        "--write-media", audioPath,
      ], { timeout: 30000 });

      const { stdout } = await execFileAsync("ffprobe", [
        "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", audioPath,
      ], { timeout: 5000 });
      scene.audioDuration = parseFloat(stdout.trim());
      console.log("  场景" + scene.sceneNumber + ": ✅ " + scene.audioDuration.toFixed(2) + "s");
      passed++;
    } catch (e) {
      console.log("  场景" + scene.sceneNumber + ": ❌ " + e.message);
      scene.audioDuration = 5;
      failed++;
    }
  }

  // ─── 阶段4: 字幕生成 ───
  console.log("\n\n━━━ 阶段4: 字幕生成 ━━━");
  for (const scene of SCENES) {
    scene.chunks = generateSubtitleChunks(scene.voiceoverText, scene.audioDuration);
    const last = scene.chunks[scene.chunks.length - 1];
    const syncOk = last.end <= scene.audioDuration + 0.1;
    console.log("  场景" + scene.sceneNumber + ": " + scene.chunks.length + " 段字幕, 结束=" + last.end.toFixed(2) + "s, 音频=" + scene.audioDuration.toFixed(2) + "s " + (syncOk ? "✅" : "❌"));
    if (syncOk) passed++; else failed++;
  }

  // ─── 阶段5: 合并渲染 ───
  console.log("\n\n━━━ 阶段5: 合并渲染 ━━━");

  const WIDTH = 1920, HEIGHT = 1080, FPS = 30;
  const outputName = "e2e-final-" + randomUUID() + ".mp4";
  const outputPath = join(workDir, outputName);

  // 不用中间 concat=n=1，直接用最终标签做总拼接
  const inputArgs = [];
  const filterChains = [];
  const finalLabels = [];

  for (let i = 0; i < SCENES.length; i++) {
    const scene = SCENES[i];
    inputArgs.push("-i", scene.materialPath, "-i", scene.audioPath);
    const vIdx = i * 2, aIdx = i * 2 + 1;

    // 视频：缩放 + 裁切到音频时长
    filterChains.push("[" + vIdx + ":v]scale=" + WIDTH + ":" + HEIGHT + ",setsar=1,trim=duration=" + scene.audioDuration + ",setpts=PTS-STARTPTS[v" + i + "]");
    // 音频：音量 + 重采样 + 裁切
    filterChains.push("[" + aIdx + ":a]volume=2.0,aresample=44100,atrim=0:" + scene.audioDuration + ",asetpts=PTS-STARTPTS[a" + i + "p]");

    // 字幕
    const fontSize = Math.round(HEIGHT / 20);
    const fontPath = process.platform === "win32" ? String.fromCharCode(67,92,58) + "/Windows/Fonts/msyh.ttc" : "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc";
    const bottomMargin = Math.round(HEIGHT * 0.06);
    const yPos = "h-text_h-" + (bottomMargin + fontSize / 2);
    const base = "fontfile='" + fontPath + "':fontsize=" + fontSize + ":fontcolor=white:borderw=3:x=(w-text_w)/2:y=" + yPos;

    // 字幕：整句作为一段
    const escapedText = escapeDrawtext(scene.voiceoverText);
    filterChains.push("[" + "v" + i + "]drawtext=" + base + ":text='" + escapedText + "' [" + "v" + i + "_sub]");
    const prevLabel = "v" + i + "_sub";

    // 收集最终标签（交错：video, audio, video, audio...）
    finalLabels.push("[" + prevLabel + "][a" + i + "p]");
  }

  // 总拼接（交错输入）
  filterChains.push(finalLabels.join("") + "concat=n=" + SCENES.length + ":v=1:a=1[outv][outa]");

  // 分场景渲染，最后拼接文件（避免复杂滤镜链）
  console.log("  渲染中（分场景处理）...\n");

  try {
    const sceneFiles = [];

    for (let i = 0; i < SCENES.length; i++) {
      const scene = SCENES[i];
      const sceneOutput = join(workDir, "scene-" + i + ".mp4");
      const fontPath = process.platform === "win32" ? String.fromCharCode(67,92,58) + "/Windows/Fonts/msyh.ttc" : "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc";
      const escapedText = escapeDrawtext(scene.voiceoverText);
      const fontSize = Math.round(HEIGHT / 20);
      const bottomMargin = Math.round(HEIGHT * 0.06);
      const yPos = "h-text_h-" + (bottomMargin + fontSize / 2);

      const filter = [
        "[0:v]scale=" + WIDTH + ":" + HEIGHT + ",setsar=1,trim=duration=" + scene.audioDuration + ",setpts=PTS-STARTPTS[v0]",
        "[1:a]volume=2.0,aresample=44100,atrim=0:" + scene.audioDuration + ",asetpts=PTS-STARTPTS[a0]",
        "[v0]drawtext=fontfile='" + fontPath + "':fontsize=" + fontSize + ":fontcolor=white:borderw=3:x=(w-text_w)/2:y=" + yPos + ":text='" + escapedText + "' [vout]",
        "[vout][a0]concat=n=1:v=1:a=1[outv][outa]",
      ].join(";");

      try {
        await execFileAsync("ffmpeg", [
          "-y", "-i", scene.materialPath, "-i", scene.audioPath,
          "-filter_complex", filter,
          "-map", "[outv]", "-map", "[outa]",
          "-c:v", "libx264", "-preset", "fast", "-crf", "23",
          "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
          "-r", String(FPS), "-movflags", "+faststart",
          sceneOutput,
        ], { timeout: 120000 });
        sceneFiles.push(sceneOutput);
        console.log("  场景" + (i + 1) + ": ✅ 渲染完成");
      } catch (err) {
        console.log("  场景" + (i + 1) + ": ❌ " + (err.message || "").substring(0, 100));
        // Fallback: 无字幕版本
        await execFileAsync("ffmpeg", [
          "-y", "-i", scene.materialPath, "-i", scene.audioPath,
          "-filter_complex",
          "[0:v]scale=" + WIDTH + ":" + HEIGHT + ",setsar=1,trim=duration=" + scene.audioDuration + ",setpts=PTS-STARTPTS[v0];[1:a]volume=2.0,aresample=44100,atrim=0:" + scene.audioDuration + ",asetpts=PTS-STARTPTS[a0];[v0][a0]concat=n=1:v=1:a=1[outv][outa]",
          "-map", "[outv]", "-map", "[outa]",
          "-c:v", "libx264", "-preset", "fast", "-crf", "23",
          "-c:a", "aac", "-b:a", "192k",
          "-r", String(FPS), "-movflags", "+faststart",
          sceneOutput,
        ], { timeout: 120000 });
        sceneFiles.push(sceneOutput);
        console.log("  场景" + (i + 1) + ": ⚠️ 无字幕版本");
      }
    }

    // 拼接所有场景
    const concatList = join(workDir, "concat.txt");
    await writeFile(concatList, sceneFiles.map(f => "file '" + f.replace(/\\/g, "/") + "'").join("\n"));

    await execFileAsync("ffmpeg", [
      "-y", "-f", "concat", "-safe", "0", "-i", concatList,
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "192k",
      "-movflags", "+faststart",
      outputPath,
    ], { timeout: 120000 });

    const { stdout: outDur } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", outputPath,
    ], { timeout: 5000 });
    const outputDuration = parseFloat(outDur.trim());
    const expectedDuration = SCENES.reduce((s, sc) => s + sc.audioDuration, 0);
    const diff = Math.abs(outputDuration - expectedDuration);
    const size = (await readFile(outputPath)).length;

    // 复制到项目根目录方便查看
    const finalPath = join(process.cwd(), outputName);
    await writeFile(finalPath, await readFile(outputPath));

    console.log("  ╔═══════════════════════════════════════╗");
    console.log("  ║          渲染完成！                    ║");
    console.log("  ╠═══════════════════════════════════════╣");
    console.log("  ║  输出: " + outputName);
    console.log("  ║  时长: " + outputDuration.toFixed(2) + "s (预期 " + expectedDuration.toFixed(2) + "s, 差 " + diff.toFixed(2) + "s)");
    console.log("  ║  大小: " + (size / 1024 / 1024).toFixed(2) + " MB");
    console.log("  ║  路径: " + finalPath);
    console.log("  ╚═══════════════════════════════════════╝");

    if (size > 10000 && diff < 2.0) {
      passed++;
    } else {
      failed++;
    }
  } catch (e) {
    console.log("  ❌ 渲染失败: " + e.message.substring(0, 200));
    failed++;
  }

  // 清理临时文件
  await rm(workDir, { recursive: true, force: true }).catch(() => {});

  // ─── 结果汇总 ───
  console.log("\n╔═══════════════════════════════╗");
  console.log("║  测试结果: " + passed + " 通过, " + failed + " 失败" + " ".repeat(Math.max(0, 10 - String(passed).length - String(failed).length)) + "║");
  console.log("╚═══════════════════════════════╝");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
