const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);
const { writeFile, readFile } = require("fs/promises");
const { join } = require("path");
const { tmpdir } = require("os");
const { randomUUID } = require("crypto");

async function test() {
  const workDir = join(tmpdir(), "dt-" + randomUUID());
  require("fs").mkdirSync(workDir, { recursive: true });

  // Create test video
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "color=c=0x1a1a2e:s=1920x1080:d=10",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-an",
    join(workDir, "v.mp4"),
  ], { timeout: 10000 });

  // Test 1: drawtext in filter_complex arg
  console.log("=== Test 1: filter_complex arg ===");
  const fontPath = "C\\\\:/Windows/Fonts/msyh.ttc";
  const text = "test text 123";
  const filter1 = "[0:v]drawtext=fontfile='" + fontPath + "':fontsize=54:fontcolor=white:x=100:y=100:text='" + text + "'[out]";
  console.log("Filter:", filter1);

  try {
    await execFileAsync("ffmpeg", [
      "-y", "-i", join(workDir, "v.mp4"),
      "-filter_complex", filter1,
      "-map", "[out]", "-c:v", "libx264", "-preset", "fast",
      join(workDir, "out1.mp4"),
    ], { timeout: 30000 });
    console.log("✅ Test 1 passed\n");
  } catch (e) {
    console.log("❌ Test 1 failed:", (e.stderr || e.message).substring(0, 200), "\n");
  }

  // Test 2: drawtext via filter_complex_script file
  console.log("=== Test 2: filter_complex_script file ===");
  const filterScript = join(workDir, "filter.txt");
  const filter2 = "[0:v]drawtext=fontfile='" + fontPath + "':fontsize=54:fontcolor=white:x=100:y=100:text='" + text + "'[out]";
  await writeFile(filterScript, filter2);
  console.log("Script content:", (await readFile(filterScript, "utf-8")).substring(0, 100));

  try {
    await execFileAsync("ffmpeg", [
      "-y", "-i", join(workDir, "v.mp4"),
      "-filter_complex_script", filterScript,
      "-map", "[out]", "-c:v", "libx264", "-preset", "fast",
      join(workDir, "out2.mp4"),
    ], { timeout: 30000 });
    console.log("✅ Test 2 passed\n");
  } catch (e) {
    console.log("❌ Test 2 failed:", (e.stderr || e.message).substring(0, 200), "\n");
  }

  // Test 3: Chinese text via file
  console.log("=== Test 3: Chinese text via file ===");
  const cnText = "朱棣从北平藩王到永乐大帝";
  // Escape for FFmpeg drawtext: backslash, single quote, colon, percent
  const escaped = cnText
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\''")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
  const filter3 = "[0:v]drawtext=fontfile='" + fontPath + "':fontsize=54:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h-text_h-60:text='" + escaped + "'[out]";
  const filterScript3 = join(workDir, "filter3.txt");
  await writeFile(filterScript3, filter3);
  console.log("Escaped text:", escaped);
  console.log("Filter:", filter3.substring(0, 120));

  try {
    await execFileAsync("ffmpeg", [
      "-y", "-i", join(workDir, "v.mp4"),
      "-filter_complex_script", filterScript3,
      "-map", "[out]", "-c:v", "libx264", "-preset", "fast",
      join(workDir, "out3.mp4"),
    ], { timeout: 30000 });
    console.log("✅ Test 3 passed\n");
  } catch (e) {
    console.log("❌ Test 3 failed:", (e.stderr || e.message).substring(0, 300), "\n");
  }

  // Test 4: drawtext with enable + label concat
  console.log("=== Test 4: drawtext + concat ===");
  const t1 = escapeForDrawtext("朱棣从北平藩王");
  const t2 = escapeForDrawtext("到永乐大帝");
  const f4a = "[0:v]trim=duration=5,setpts=PTS-STARTPTS[v0]";
  const f4b = "[0:a]atrim=0:5,asetpts=PTS-STARTPTS[a0]";
  const f4c = "[v0]drawtext=fontfile='" + fontPath + "':fontsize=54:fontcolor=white:borderw=3:x=(w-text_w)/2:y=h-text_h-60:text='" + t1 + "':enable='between(t\\,0\\,3)' [v0s0]";
  const f4d = "[v0s0]drawtext=fontfile='" + fontPath + "':fontsize=54:fontcolor=white:borderw=3:x=(w-text_w)/2:y=h-text_h-60:text='" + t2 + "':enable='between(t\\,3\\,5)' [v0_sub]";
  const f4e = "[v0_sub][a0]concat=n=1:v=1:a=1[outv][outa]";
  const filterScript4 = join(workDir, "filter4.txt");
  await writeFile(filterScript4, [f4a, f4b, f4c, f4d, f4e].join("\n"));

  // Need audio input
  await execFileAsync("ffmpeg", [
    "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-t", "5", "-c:a", "aac", join(workDir, "a.mp3"),
  ], { timeout: 10000 });

  try {
    await execFileAsync("ffmpeg", [
      "-y", "-i", join(workDir, "v.mp4"), "-i", join(workDir, "a.mp3"),
      "-filter_complex_script", filterScript4,
      "-map", "[outv]", "-map", "[outa]",
      "-c:v", "libx264", "-preset", "fast", "-c:a", "aac",
      join(workDir, "out4.mp4"),
    ], { timeout: 30000 });
    console.log("✅ Test 4 passed\n");
  } catch (e) {
    console.log("❌ Test 4 failed:", (e.stderr || e.message).substring(0, 300), "\n");
  }

  require("fs").rmSync(workDir, { recursive: true, force: true });
}

function escapeForDrawtext(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "'\\''")
    .replace(/:/g, "\\:")
    .replace(/%/g, "\\%");
}

test().catch(console.error);
