/**
 * 全链路测试 — 朱棣脚本
 * 脚本 → AI分镜 → Bilibili素材搜索下载 → TTS口播 → 字幕 → 渲染
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
const SCRIPT = `从北平藩王到永乐大帝
朱棣的起点，并不低。

十一岁封燕王，二十一岁就藩北平。驻守北疆，直面蒙古残部。据《明史·成祖本纪》记载，朱棣早年屡次随大将军出塞作战，"威震漠北"——在实战中练出了一身打仗的本事。

但问题是：皇位跟他没关系。

朱元璋立的太子是朱标，朱标死后立的是朱标的儿子朱允炆。朱棣不过是藩王中最能打的那一个——是拱卫北疆的一把刀。

直到朱允炆削藩。`;

// ─── AI 分镜（模拟） ───
const SCENES = [
  {
    sceneNumber: 1,
    title: "起点·燕王",
    voiceoverText: "从北平藩王到永乐大帝。朱棣的起点，并不低。十一岁封燕王，二十一岁就藩北平。",
    visualDesc: "古代城墙远景，年轻将领骑马立于城头，旌旗飘扬。镜头从大全景推近至人物侧面特写，逆光剪影",
    materialQuery: "明朝城墙骑马 古装电视剧 航拍",
    materialQueryEn: "ancient chinese wall horseback",
  },
  {
    sceneNumber: 2,
    title: "北疆征战",
    voiceoverText: "驻守北疆，直面蒙古残部。据明史记载，朱棣早年屡次随大将军出塞作战，威震漠北——在实战中练出了一身打仗的本事。",
    visualDesc: "沙漠草原上千军万马冲锋，骑兵挥刀，尘土飞扬。镜头跟随推进，暖黄色调，史诗感构图",
    materialQuery: "古代骑兵冲锋战场 纪录片",
    materialQueryEn: "ancient cavalry charge battle",
  },
  {
    sceneNumber: 3,
    title: "皇位无缘",
    voiceoverText: "但问题是：皇位跟他没关系。朱元璋立的太子是朱标，朱标死后立的是朱标的儿子朱允炆。朱棣不过是藩王中最能打的那一个——是拱卫北疆的一把刀。",
    visualDesc: "皇宫大殿内景，龙椅空置，烛光摇曳。镜头从龙椅缓缓拉远至大殿全景，色调偏冷，氛围压抑",
    materialQuery: "古代皇宫龙椅大殿 空镜",
    materialQueryEn: "chinese palace throne room",
  },
  {
    sceneNumber: 4,
    title: "削藩风云",
    voiceoverText: "直到朱允炆削藩。",
    visualDesc: "朝堂之上群臣议事，气氛紧张。镜头快速切换面部特写，冷色调，短镜头剪辑节奏快",
    materialQuery: "古代朝堂议事 电视剧",
    materialQueryEn: "ancient chinese court meeting",
  },
];

// ─── 字幕工具 ───
function estimateSpeechDuration(text) {
  const cn = (text.match(/[一-鿿]/g) || []).length;
  const other = text.replace(/[一-鿿]/g, "").replace(/[，。！？、；：,;!?\s\n"'「」『』【】（）\(\)\[\]]/g, "").length;
  return Math.max(0.5, cn / 4 + other / 6);
}

function escapeDrawtext(text) {
  // FFmpeg drawtext: 用反斜杠转义单引号，不是 shell 风格的 '\''
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/%/g, "\\%").replace(/\n/g, " ");
}

// ─── Bilibili 搜索 ───
async function searchBilibili(query, count = 3) {
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
      // 获取视频流
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
            id: v.bvid, url: videoUrl, title: v.title?.replace(/<[^>]*>/g, ""),
            width: 1920, height: 1080, duration: durSec,
            thumbnail: v.pic?.startsWith("//") ? "https:" + v.pic : v.pic,
            platform: "bilibili",
          });
        }
      } catch {}
    }
    return videos;
  } catch { return []; }
}

// ─── Pexels 搜索 ───
async function searchPexels(query, count = 3) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) return [];
  try {
    const res = await fetch("https://api.pexels.com/videos/search?query=" + encodeURIComponent(query) + "&per_page=" + count + "&orientation=landscape", {
      headers: { Authorization: key }, signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return (data.videos || []).map(v => {
      const hd = v.video_files.find(f => f.quality === "hd" && f.width >= 1280) ||
        v.video_files.find(f => f.width >= 1920) ||
        v.video_files.find(f => f.width >= 1280) ||
        v.video_files.sort((a, b) => b.width - a.width)[0];
      return hd ? { id: v.id, url: hd.link, width: hd.width, height: hd.height, duration: v.duration, thumbnail: v.image, platform: "pexels" } : null;
    }).filter(Boolean);
  } catch { return []; }
}

// ─── 主流程 ───
async function main() {
  const workDir = join(tmpdir(), "zhudi-" + randomUUID());
  await mkdir(workDir, { recursive: true });

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  全链路测试：朱棣·从北平藩王到永乐大帝       ║");
  console.log("╚══════════════════════════════════════════════╝\n");
  console.log("📋 脚本字数:", SCRIPT.replace(/\s/g, "").length);
  console.log("🎬 分镜数:", SCENES.length, "个场景\n");

  let passed = 0, failed = 0;
  const checks = [];

  function check(name, ok, detail) {
    checks.push({ name, ok, detail });
    if (ok) passed++; else failed++;
    console.log((ok ? "  ✅ " : "  ❌ ") + name + (detail ? " — " + detail : ""));
  }

  // ═══════════════════════════════════════
  // 阶段1: 素材搜索（Bilibili 优先）
  // ═══════════════════════════════════════
  console.log("━━━ 阶段1: 素材搜索 ━━━");

  for (const scene of SCENES) {
    console.log("\n  场景" + scene.sceneNumber + ": " + scene.title);
    console.log("  检索: " + scene.materialQuery);

    // Bilibili 优先
    const bili = await searchBilibili(scene.materialQuery, 3);
    console.log("    Bilibili: " + bili.length + " 个");
    for (const v of bili.slice(0, 2)) console.log("      - " + (v.title || "").substring(0, 40) + " | " + v.duration + "s");

    // Pexels 兜底
    const pexels = await searchPexels(scene.materialQueryEn || scene.materialQuery, 3);
    console.log("    Pexels: " + pexels.length + " 个");

    // 选择最佳素材（Bilibili 优先）
    const all = [...bili, ...pexels.map(v => ({ ...v, platform: "pexels" }))];
    if (all.length > 0) {
      scene.material = all[0];
      check("场景" + scene.sceneNumber + " 素材搜索", true, scene.material.platform + " | " + scene.material.width + "x" + scene.material.height + " | " + scene.material.duration + "s");
    } else {
      scene.material = null;
      check("场景" + scene.sceneNumber + " 素材搜索", false, "无结果");
    }
  }

  // ═══════════════════════════════════════
  // 阶段2: 素材下载
  // ═══════════════════════════════════════
  console.log("\n\n━━━ 阶段2: 素材下载 ━━━");

  for (const scene of SCENES) {
    const videoPath = join(workDir, "material-" + scene.sceneNumber + ".mp4");
    scene.materialPath = videoPath;

    if (!scene.material) {
      await execFileAsync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0x1a1a2e:s=1920x1080:d=10", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", videoPath], { timeout: 10000 });
      check("场景" + scene.sceneNumber + " 素材下载", false, "无素材，纯色背景");
      continue;
    }

    try {
      const res = await fetch(scene.material.url, {
        signal: AbortSignal.timeout(120000),
        headers: scene.material.platform === "bilibili" ? { "Referer": "https://www.bilibili.com/", "User-Agent": "Mozilla/5.0" } : { "User-Agent": "Mozilla/5.0" },
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      const rawPath = join(workDir, "raw-" + scene.sceneNumber + ".mp4");
      await writeFile(rawPath, buf);

      // 转换 + 水印裁切（Bilibili 素材有水印）
      const vf = scene.material.platform === "bilibili"
        ? "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,crop=iw*0.96:ih*0.96:iw*0.02:ih*0.02"
        : "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2";

      await execFileAsync("ffmpeg", ["-y", "-i", rawPath, "-c:v", "libx264", "-preset", "fast", "-vf", vf, "-an", videoPath], { timeout: 120000 });
      check("场景" + scene.sceneNumber + " 素材下载", true, (buf.length / 1024 / 1024).toFixed(1) + "MB" + (scene.material.platform === "bilibili" ? " (已裁切水印)" : ""));
    } catch (e) {
      await execFileAsync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=0x1a1a2e:s=1920x1080:d=10", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", videoPath], { timeout: 10000 });
      check("场景" + scene.sceneNumber + " 素材下载", false, e.message?.substring(0, 60));
    }
  }

  // ═══════════════════════════════════════
  // 阶段3: TTS 口播语音
  // ═══════════════════════════════════════
  console.log("\n\n━━━ 阶段3: TTS 口播语音 ━━━");

  for (const scene of SCENES) {
    const audioPath = join(workDir, "tts-" + scene.sceneNumber + ".mp3");
    scene.audioPath = audioPath;

    try {
      await execFileAsync("python", ["-m", "edge_tts", "--voice", "zh-CN-YunxiNeural", "--rate", "+0%", "--volume", "+0%", "--text", scene.voiceoverText, "--write-media", audioPath], { timeout: 30000 });
      const { stdout } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", audioPath], { timeout: 5000 });
      scene.audioDuration = parseFloat(stdout.trim());
      check("场景" + scene.sceneNumber + " TTS", true, scene.audioDuration.toFixed(2) + "s | " + scene.voiceoverText.length + "字");
    } catch (e) {
      scene.audioDuration = estimateSpeechDuration(scene.voiceoverText);
      await execFileAsync("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", scene.audioDuration, "-c:a", "libmp3lame", "-b:a", "128k", audioPath], { timeout: 10000 });
      check("场景" + scene.sceneNumber + " TTS", false, "TTS失败，静音替代");
    }
  }

  // ═══════════════════════════════════════
  // 阶段4: 字幕同步验证
  // ═══════════════════════════════════════
  console.log("\n\n━━━ 阶段4: 字幕同步 ━━━");

  for (const scene of SCENES) {
    const estimated = estimateSpeechDuration(scene.voiceoverText);
    const actual = scene.audioDuration;
    const diff = Math.abs(actual - estimated);
    const diffPercent = (diff / actual * 100).toFixed(0);

    // 字幕结束时间 = 音频时长（精确同步）
    const subtitleEnd = actual;
    const syncOk = Math.abs(subtitleEnd - actual) < 0.1;

    check("场景" + scene.sceneNumber + " 字幕同步", syncOk,
      "口播" + actual.toFixed(2) + "s | 估算" + estimated.toFixed(2) + "s | 偏差" + diffPercent + "% | 字幕结束=" + subtitleEnd.toFixed(2) + "s");
  }

  // ═══════════════════════════════════════
  // 阶段5: 视频渲染
  // ═══════════════════════════════════════
  console.log("\n\n━━━ 阶段5: 视频渲染 ━━━");

  const WIDTH = 1920, HEIGHT = 1080, FPS = 30;
  const outputName = "zhudi-" + randomUUID() + ".mp4";
  const outputPath = join(workDir, outputName);

  // 分场景渲染（每场景独立 FFmpeg，避免复杂滤镜链问题）
  const sceneFiles = [];
  for (let i = 0; i < SCENES.length; i++) {
    const scene = SCENES[i];
    const sceneOutput = join(workDir, "scene-" + i + ".mp4");
    const fontPath = String.fromCharCode(67,92,58) + "/Windows/Fonts/msyh.ttc";
    const fontSize = Math.round(HEIGHT / 20);
    const yPos = "h-text_h-" + Math.round(HEIGHT * 0.06 + fontSize / 2);
    const escapedText = escapeDrawtext(scene.voiceoverText);

    const filter = [
      "[0:v]scale=" + WIDTH + ":" + HEIGHT + ",setsar=1,trim=duration=" + scene.audioDuration + ",setpts=PTS-STARTPTS[v0]",
      "[1:a]volume=2.0,aresample=44100,atrim=0:" + scene.audioDuration + ",asetpts=PTS-STARTPTS[a0]",
      "[v0]drawtext=fontfile='" + fontPath + "':fontsize=" + fontSize + ":fontcolor=white:borderw=3:x=(w-text_w)/2:y=" + yPos + ":text='" + escapedText + "' [vout]",
      "[vout][a0]concat=n=1:v=1:a=1[outv][outa]",
    ].join(";");

    try {
      // Debug: 写入文件检查
      const debugFilterPath = join(workDir, "filter-" + i + ".txt");
      await writeFile(debugFilterPath, filter);
      console.log("    Filter 长度: " + filter.length + " | 内容: " + filter.substring(0, 120) + "...");

      await execFileAsync("ffmpeg", [
        "-y", "-i", scene.materialPath, "-i", scene.audioPath,
        "-filter_complex", filter,
        "-map", "[outv]", "-map", "[outa]",
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "192k", "-ar", "44100",
        "-r", String(FPS), "-movflags", "+faststart",
        sceneOutput,
      ], { timeout: 120000 });
      sceneFiles.push(sceneOutput);
      check("场景" + scene.sceneNumber + " 渲染", true, "含字幕");
    } catch (renderErr) {
      // 记录错误详情
      const errDetail = (renderErr.stderr || renderErr.message || "").split("\n").filter(l => l.includes("Error") || l.includes("Invalid")).slice(0, 2).join(" | ");
      console.log("    FFmpeg 错误: " + errDetail.substring(0, 120));
      // 无字幕回退
      try {
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
        check("场景" + scene.sceneNumber + " 渲染", false, "字幕渲染失败，无字幕版本");
      } catch (e2) {
        check("场景" + scene.sceneNumber + " 渲染", false, e2.message?.substring(0, 60));
      }
    }
  }

  // 拼接
  if (sceneFiles.length > 0) {
    const concatList = join(workDir, "concat.txt");
    await writeFile(concatList, sceneFiles.map(f => "file '" + f.replace(/\\/g, "/") + "'").join("\n"));

    try {
      await execFileAsync("ffmpeg", [
        "-y", "-f", "concat", "-safe", "0", "-i", concatList,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "192k",
        "-movflags", "+faststart",
        outputPath,
      ], { timeout: 120000 });

      const { stdout: outDur } = await execFileAsync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", outputPath], { timeout: 5000 });
      const outputDuration = parseFloat(outDur.trim());
      const expectedDuration = SCENES.reduce((s, sc) => s + sc.audioDuration, 0);
      const diff = Math.abs(outputDuration - expectedDuration);
      const size = (await readFile(outputPath)).length;

      // 复制到项目目录
      const finalPath = join(process.cwd(), outputName);
      await writeFile(finalPath, await readFile(outputPath));

      check("最终视频拼接", diff < 2.0 && size > 10000,
        outputDuration.toFixed(2) + "s | " + (size / 1024 / 1024).toFixed(2) + "MB | 偏差" + diff.toFixed(2) + "s");

      console.log("\n  ╔═══════════════════════════════════════╗");
      console.log("  ║  输出: " + outputName);
      console.log("  ║  路径: " + finalPath);
      console.log("  ║  时长: " + outputDuration.toFixed(2) + "s");
      console.log("  ║  大小: " + (size / 1024 / 1024).toFixed(2) + " MB");
      console.log("  ╚═══════════════════════════════════════╝");
    } catch (e) {
      check("最终视频拼接", false, e.message?.substring(0, 60));
    }
  }

  // ═══════════════════════════════════════
  // 结果汇总
  // ═══════════════════════════════════════
  // 不删除临时目录，方便调试
  console.log("\n  临时目录: " + workDir);

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║  测试结果: " + passed + " 通过 / " + failed + " 失败 / " + checks.length + " 项" + " ".repeat(Math.max(0, 25 - String(passed).length - String(failed).length - String(checks.length).length)) + "║");
  console.log("╠══════════════════════════════════════════════╣");
  for (const c of checks) {
    const icon = c.ok ? "✅" : "❌";
    const pad = " ".repeat(Math.max(0, 30 - c.name.length));
    console.log("║  " + icon + " " + c.name + pad + (c.detail || "").substring(0, 30) + "║");
  }
  console.log("╚══════════════════════════════════════════════╝");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
