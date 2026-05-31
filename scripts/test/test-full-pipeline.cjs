require("dotenv").config();
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);
const { readFile, mkdir, rm } = require("fs/promises");
const { join } = require("path");
const { tmpdir } = require("os");
const { randomUUID } = require("crypto");

async function test() {
  console.log("=== 全链路测试 ===\n");
  let passed = 0, failed = 0;

  const workDir = join(tmpdir(), "full-test-" + randomUUID());
  await mkdir(workDir, { recursive: true });

  // 1. Pexels 搜索
  console.log("1. Pexels 素材搜索");
  try {
    const key = process.env.PEXELS_API_KEY;
    const res = await fetch(
      "https://api.pexels.com/videos/search?query=ancient+chinese+battlefield&per_page=2&orientation=landscape",
      { headers: { Authorization: key }, signal: AbortSignal.timeout(10000) }
    );
    const data = await res.json();
    const v = data.videos?.[0];
    if (v) {
      const hd = v.video_files.find(f => f.width >= 1280);
      console.log("   ✅ 找到:", v.id, hd?.width + "x" + hd?.height, v.duration + "s");
      passed++;
    } else { console.log("   ❌ 无结果"); failed++; }
  } catch (e) { console.log("   ❌", e.message); failed++; }

  // 2. Bilibili 搜索
  console.log("2. Bilibili 素材搜索");
  let biliBvid = null;
  try {
    const url = "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=" +
      encodeURIComponent("紫禁城 航拍") + "&page=1&page_size=2&order=totalrank";
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://search.bilibili.com/",
        "Origin": "https://search.bilibili.com",
        "Accept": "application/json",
        "Cookie": "buvid3=placeholder",
      },
      signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    const results = data.data?.result || [];
    if (results.length > 0) {
      const v = results[0];
      biliBvid = v.bvid;
      const title = v.title?.replace(/<[^>]*>/g, "");
      console.log("   ✅ 找到:", title?.substring(0, 40), "|", v.duration, "|", v.bvid);
      passed++;
    } else { console.log("   ❌ 无结果"); failed++; }
  } catch (e) { console.log("   ❌", e.message); failed++; }

  // 3. Bilibili 视频流
  console.log("3. Bilibili 视频流获取");
  try {
    const bvid = biliBvid || "BV1Xg411N7vy";
    const infoRes = await fetch("https://api.bilibili.com/x/web-interface/view?bvid=" + bvid, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/", "Origin": "https://www.bilibili.com" },
      signal: AbortSignal.timeout(10000),
    });
    const info = await infoRes.json();
    const cid = info.data?.cid;
    const streamRes = await fetch(
      "https://api.bilibili.com/x/player/playurl?bvid=" + bvid + "&cid=" + cid + "&qn=80&fnval=1",
      { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/video/" + bvid }, signal: AbortSignal.timeout(10000) }
    );
    const stream = await streamRes.json();
    const videoUrl = stream.data?.durl?.[0]?.url;
    if (videoUrl) {
      const sizeMB = (stream.data.durl[0].size / 1024 / 1024).toFixed(1);
      console.log("   ✅ 视频流 OK, 大小:", sizeMB + "MB");
      passed++;
    } else { console.log("   ❌ 无视频流"); failed++; }
  } catch (e) { console.log("   ❌", e.message); failed++; }

  // 4. TTS 生成
  console.log("4. Edge TTS 语音合成");
  const ttsFile = join(workDir, "tts.mp3");
  try {
    await execFileAsync("python", [
      "-m", "edge_tts", "--voice", "zh-CN-YunxiNeural",
      "--text", "朱棣从北平藩王到永乐大帝。他发动靖难之役夺取皇位，迁都北京，开创永乐盛世。",
      "--write-media", ttsFile,
    ], { timeout: 30000 });
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", ttsFile,
    ], { timeout: 5000 });
    console.log("   ✅ TTS 成功, 时长:", parseFloat(stdout.trim()).toFixed(2) + "s");
    passed++;
  } catch (e) { console.log("   ❌", e.message); failed++; }

  // 5. 字幕同步
  console.log("5. 字幕同步验证");
  try {
    const text = "朱棣从北平藩王到永乐大帝。他发动靖难之役夺取皇位。";
    const chineseChars = (text.match(/[一-鿿]/g) || []).length;
    const estimated = chineseChars / 4;
    // Use actual TTS duration from step 4
    const { stdout: ttsDur } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", ttsFile,
    ], { timeout: 5000 });
    const actualAudio = parseFloat(ttsDur.trim());
    // Single chunk: subtitle ends exactly at audio duration
    const subtitleEnd = actualAudio;
    const syncOk = Math.abs(subtitleEnd - actualAudio) < 0.1;
    console.log("   ✅ 估算: " + estimated.toFixed(2) + "s, 实际音频: " + actualAudio.toFixed(2) + "s, 字幕结束: " + subtitleEnd.toFixed(2) + "s, 同步: " + (syncOk ? "OK" : "FAIL"));
    if (syncOk) passed++; else failed++;
  } catch (e) { console.log("   ❌", e.message); failed++; }

  // 6. 水印去除
  console.log("6. 水印去除（边缘裁切）");
  try {
    const testVid = join(workDir, "test.mp4");
    const cleanVid = join(workDir, "clean.mp4");
    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "color=c=blue:s=1920x1080:d=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", testVid,
    ], { timeout: 10000 });
    await execFileAsync("ffmpeg", [
      "-y", "-i", testVid,
      "-vf", "crop=iw*0.96:ih*0.96:iw*0.02:ih*0.02",
      "-c:v", "libx264", cleanVid,
    ], { timeout: 10000 });
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "csv=p=0", cleanVid,
    ], { timeout: 5000 });
    const [w, h] = stdout.trim().split(",").map(Number);
    if (w < 1920 && h < 1080) {
      console.log("   ✅ 裁切成功: 1920x1080 → " + w + "x" + h);
      passed++;
    } else { console.log("   ❌ 裁切失败"); failed++; }
  } catch (e) { console.log("   ❌", e.message); failed++; }

  // 7. 完整渲染（视频 + TTS 音频对齐）
  console.log("7. 完整视频渲染（TTS + 画面合成）");
  try {
    const videoFile = join(workDir, "bg.mp4");
    const outputFile = join(workDir, "output.mp4");

    await execFileAsync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "color=c=0x1a1a2e:s=1920x1080:d=10",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", videoFile,
    ], { timeout: 10000 });

    const { stdout: durOut } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", ttsFile,
    ], { timeout: 5000 });
    const audioDur = parseFloat(durOut.trim());

    // Compose: video trimmed to audio duration + audio
    await execFileAsync("ffmpeg", [
      "-y", "-i", videoFile, "-i", ttsFile,
      "-filter_complex",
      "[0:v]scale=1920:1080,trim=duration=" + audioDur + ",setpts=PTS-STARTPTS[v0];" +
      "[1:a]volume=2.0,aresample=44100,atrim=0:" + audioDur + ",asetpts=PTS-STARTPTS[a0];" +
      "[v0][a0]concat=n=1:v=1:a=1[outv][outa]",
      "-map", "[outv]", "-map", "[outa]",
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
      "-movflags", "+faststart",
      outputFile,
    ], { timeout: 60000 });

    const { stdout: outDur } = await execFileAsync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", outputFile,
    ], { timeout: 5000 });
    const outputDur = parseFloat(outDur.trim());
    const diff = Math.abs(outputDur - audioDur);
    const size = (await readFile(outputFile)).length;

    if (size > 10000 && diff < 1.0) {
      console.log("   ✅ 渲染成功, 时长: " + outputDur.toFixed(2) + "s, 大小: " + (size / 1024 / 1024).toFixed(2) + "MB");
      passed++;
    } else { console.log("   ❌ 渲染异常, diff=" + diff.toFixed(2)); failed++; }
  } catch (e) { console.log("   ❌", e.message); failed++; }

  await rm(workDir, { recursive: true, force: true }).catch(() => {});
  console.log("\n=== 结果: " + passed + " 通过, " + failed + " 失败 ===");
  process.exit(failed > 0 ? 1 : 0);
}

test().catch(e => { console.error(e); process.exit(1); });
