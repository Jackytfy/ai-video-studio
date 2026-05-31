const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);
const { writeFile, rm } = require("fs/promises");
const { join } = require("path");
const { tmpdir } = require("os");
const { randomUUID } = require("crypto");

function escapeDrawtext(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\''")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

async function test() {
  const d = join(tmpdir(), "dt2-" + randomUUID());
  await require("fs/promises").mkdir(d, { recursive: true });

  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "color=c=0x1a1a2e:s=1920x1080:d=10",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", join(d, "v.mp4"),
  ], { timeout: 10000 });

  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-t", "5", "-c:a", "libmp3lame", "-b:a", "128k", join(d, "a.mp3"),
  ], { timeout: 10000 });

  // Correct font path for Windows FFmpeg
  const fontPath = "C\\:/Windows/Fonts/msyh.ttc";
  const text1 = escapeDrawtext("朱棣从北平藩王");
  const text2 = escapeDrawtext("到永乐大帝");

  const lines = [
    "[0:v]scale=1920:1080,trim=duration=5,setpts=PTS-STARTPTS[v0]",
    "[1:a]volume=2.0,aresample=44100,atrim=0:5,asetpts=PTS-STARTPTS[a0]",
    "[v0]drawtext=fontfile='" + fontPath + "':fontsize=54:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-text_h-60:text='" + text1 + "':enable='between(t\\,0\\,3)' [v0s0]",
    "[v0s0]drawtext=fontfile='" + fontPath + "':fontsize=54:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-text_h-60:text='" + text2 + "':enable='between(t\\,3\\,5)' [v0_sub]",
    "[v0_sub][a0]concat=n=1:v=1:a=1[outv][outa]",
  ];

  const sf = join(d, "filter.txt");
  await writeFile(sf, lines.join("\n"));

  console.log("Font path:", fontPath);
  console.log("Text1 escaped:", text1);
  console.log("Text2 escaped:", text2);
  console.log("Filter script:");
  for (const l of lines) console.log("  " + l);

  try {
    await execFileAsync("ffmpeg", [
      "-y", "-i", join(d, "v.mp4"), "-i", join(d, "a.mp3"),
      "-filter_complex_script", sf,
      "-map", "[outv]", "-map", "[outa]",
      "-c:v", "libx264", "-preset", "fast", "-c:a", "aac", "-b:a", "192k",
      join(d, "out.mp4"),
    ], { timeout: 60000 });
    console.log("\n✅ 渲染成功");
  } catch (e) {
    console.log("\n❌ 失败:", (e.stderr || e.message).substring(0, 500));
  }

  await rm(d, { recursive: true, force: true }).catch(() => {});
}

test().catch(console.error);
