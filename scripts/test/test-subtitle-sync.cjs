/**
 * Test subtitle sync improvements.
 * Verifies that subtitle timing correctly distributes across audio duration
 * for mixed Chinese/English content.
 */

// Inline the functions since we can't import TS directly
function speakableChars(text) {
  return text.replace(/[，。！？、；：,;!?\s\n"'「」『』【】（）\(\)\[\]]/g, "").length;
}

function estimateSpeechDuration(text) {
  const chineseChars = (text.match(/[一-鿿]/g) || []).length;
  const nonChineseSpeakable = text
    .replace(/[一-鿿]/g, "")
    .replace(/[，。！？、；：,;!?\s\n"'「」『』【】（）\(\)\[\]]/g, "").length;

  const chineseSecs = chineseChars / 4;
  const nonChineseSecs = nonChineseSpeakable / 6;

  return Math.max(0.5, chineseSecs + nonChineseSecs);
}

// Test cases
const tests = [
  {
    name: "Pure Chinese text",
    text: "朱棣从北平藩王到永乐大帝的传奇一生充满了战争与权谋",
    expectedRate: 4, // chars per second
  },
  {
    name: "Mixed Chinese/English",
    text: "在AI技术快速发展的今天，GPT-4已经能够完成复杂任务",
    expectedDuration: null, // just check it's reasonable
  },
  {
    name: "Pure English",
    text: "The quick brown fox jumps over the lazy dog near the river",
    // 47 non-Chinese speakable chars / 6 chars/sec ≈ 7.83s
    expectedDuration: 7.83,
    tolerance: 0.5,
  },
  {
    name: "Numbers and Chinese",
    text: "公元1402年，朱棣发动靖难之役，历时4年夺取皇位",
    expectedDuration: null,
  },
  {
    name: "Short text",
    text: "你好",
    expectedMinDuration: 0.5,
  },
];

console.log("=== Subtitle Sync Test ===\n");

let passed = 0;
let failed = 0;

for (const test of tests) {
  const duration = estimateSpeechDuration(test.text);
  const speakable = speakableChars(test.text);

  let ok = true;
  let detail = "";

  if (test.expectedRate) {
    const actualRate = speakable / duration;
    const rateDiff = Math.abs(actualRate - test.expectedRate);
    if (rateDiff > 1) {
      ok = false;
      detail = `rate ${actualRate.toFixed(1)} != expected ${test.expectedRate}`;
    }
  }

  if (test.expectedMinDuration) {
    if (duration < test.expectedMinDuration) {
      ok = false;
      detail = `duration ${duration.toFixed(2)} < min ${test.expectedMinDuration}`;
    }
  }

  if (test.expectedDuration === null) {
    // Just check it's between 0.5 and 60
    if (duration < 0.5 || duration > 60) {
      ok = false;
      detail = `duration ${duration.toFixed(2)} out of range`;
    }
  }

  if (typeof test.expectedDuration === "number" && test.expectedDuration !== null) {
    const tol = test.tolerance || 1;
    if (Math.abs(duration - test.expectedDuration) > tol) {
      ok = false;
      detail = `duration ${duration.toFixed(2)} != expected ${test.expectedDuration} (±${tol})`;
    }
  }

  const status = ok ? "✅ PASS" : "❌ FAIL";
  console.log(`${status} | ${test.name}`);
  console.log(`  Text: "${test.text}"`);
  console.log(`  Speakable chars: ${speakable}, Duration: ${duration.toFixed(2)}s`);
  if (detail) console.log(`  Issue: ${detail}`);
  console.log();

  if (ok) passed++;
  else failed++;
}

// Test: subtitle timing distribution
console.log("=== Subtitle Timing Distribution ===\n");

const longText = "朱棣从北平藩王到永乐大帝的传奇一生。他发动靖难之役夺取皇位，迁都北京，编纂永乐大典，派遣郑和下西洋。";
const audioDuration = 15; // simulate 15s audio
const totalSpeakable = speakableChars(longText);
const totalEstimated = estimateSpeechDuration(longText);

console.log(`Text: "${longText}"`);
console.log(`Speakable chars: ${totalSpeakable}`);
console.log(`Estimated speech duration: ${totalEstimated.toFixed(2)}s`);
console.log(`Actual audio duration: ${audioDuration}s`);

// Simulate proportional distribution
const sentences = longText.split(/(?<=[。！？；,;!?])/).filter(s => s.length > 0);
let timeCursor = 0;
console.log("\nChunk timing:");
for (const sentence of sentences) {
  const lineDuration = estimateSpeechDuration(sentence);
  const proportion = lineDuration / totalEstimated;
  const chunkDuration = Math.min(proportion * audioDuration * 1.03, proportion * audioDuration + 0.3);
  const start = timeCursor;
  timeCursor += chunkDuration;
  const end = Math.min(timeCursor, audioDuration);
  console.log(`  [${start.toFixed(2)}s - ${end.toFixed(2)}s] "${sentence}"`);
}

console.log(`\nFinal time cursor: ${timeCursor.toFixed(2)}s (should be <= ${audioDuration}s)`);
if (timeCursor <= audioDuration + 0.5) {
  console.log("✅ PASS | Subtitles fit within audio duration");
  passed++;
} else {
  console.log("❌ FAIL | Subtitles exceed audio duration!");
  failed++;
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
