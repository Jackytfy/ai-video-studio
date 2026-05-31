const { execFile } = require("child_process");
const { promisify } = require("util");
const exec = promisify(execFile);
const fs = require("fs");
const path = require("path");
const os = require("os");

(async () => {
  const d = path.join(os.tmpdir(), "dt6");
  fs.mkdirSync(d, { recursive: true });

  await exec("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=640x360:d=5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an", path.join(d, "v.mp4")], { timeout: 10000 });
  await exec("ffmpeg", ["-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "3", "-c:a", "libmp3lame", path.join(d, "a.mp3")], { timeout: 10000 });

  // The correct font path for FFmpeg on Windows
  const fontPath = "C\\:/Windows/Fonts/msyh.ttc";
  console.log("Font path literal:", fontPath);
  console.log("Font path bytes:", Buffer.from(fontPath).toString("hex"));

  const filter = [
    "[0:v]trim=duration=3,setpts=PTS-STARTPTS[v0]",
    "[1:a]atrim=0:3,asetpts=PTS-STARTPTS[a0]",
    "[v0]drawtext=fontfile='" + fontPath + "':fontsize=30:fontcolor=white:x=50:y=50:text='test'[outv]",
    "[outv][a0]concat=n=1:v=1:a=1[ov][oa]",
  ].join(";");

  fs.writeFileSync(path.join(d, "f.txt"), filter, "utf-8");

  const fileContent = fs.readFileSync(path.join(d, "f.txt"), "utf-8");
  console.log("File content:", fileContent);
  console.log("File bytes:", Buffer.from(fileContent).toString("hex").substring(0, 200));

  try {
    await exec("ffmpeg", ["-y", "-i", path.join(d, "v.mp4"), "-i", path.join(d, "a.mp3"), "-filter_complex_script", path.join(d, "f.txt"), "-map", "[ov]", "-map", "[oa]", "-c:v", "libx264", "-c:a", "aac", path.join(d, "out.mp4")], { timeout: 30000 });
    console.log("\nOK");
  } catch (e) {
    const err = e.stderr || e.message || "";
    const lines = err.split("\n");
    const errLines = lines.filter(l => l.includes("Error") || l.includes("Invalid"));
    console.log("\nFAIL:");
    for (const l of errLines.slice(0, 5)) console.log("  " + l.trim());
  }
})();
