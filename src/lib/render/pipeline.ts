import { spawn, execFile } from "child_process";
import { prisma } from "@/lib/db";
import { transitionProject } from "@/lib/state-machine";
import { promisify } from "util";
import { readFile, writeFile, unlink, mkdir, rm } from "fs/promises";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { join } from "path";
import { probeDimensions, detectWatermarkRegions } from "@/lib/materials/watermark";
import { getBilibiliWatermarkRegions } from "@/lib/materials/watermark-config";
import { searchBilibiliVideos } from "@/lib/materials/bilibili";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import { decryptSecret } from "@/lib/utils/crypto";
import { generateVideoFromScene } from "@/lib/video-gen";
import {
  generateSubtitleChunks,
  buildSubtitleFilterChain,
  estimateAudioDuration,
  getDefaultFontPath,
  type SubtitleConfig,
} from "./subtitle";
import { mapConcurrent } from "@/lib/utils/concurrent";


const execFileAsync = promisify(execFile);

// ── Progress Tracking Helper ────────────────────────────────────────
/**
 * Update render job progress with stage-specific details.
 * Sends granular progress to frontend via SSE polling.
 */
async function updateRenderProgress(
  renderJobId: string,
  options: {
    currentStage?: string;
    progress?: number;           // 0-100 overall
    sceneIndex?: number;         // Current scene being processed
    totalScenes?: number;        // Total scenes
    sceneStage?: string;         // "tts" | "ai_generation" | "materials" | "compose"
    sceneStatus?: string;        // Status message (e.g., "generating at 30%")
    estimatedRemaining?: number; // Estimated seconds remaining
  }
) {
  try {
    const data: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };

    if (options.currentStage !== undefined) data.currentStage = options.currentStage;
    if (options.progress !== undefined) data.progress = options.progress;
    if (options.estimatedRemaining !== undefined) data.estimatedDuration = options.estimatedRemaining;

    // Scene-level progress details
    const sceneProgress: Record<string, any> = {};
    if (options.sceneIndex !== undefined) sceneProgress.sceneIndex = options.sceneIndex;
    if (options.totalScenes !== undefined) sceneProgress.totalScenes = options.totalScenes;
    if (options.sceneStage !== undefined) sceneProgress.stage = options.sceneStage;
    if (options.sceneStatus !== undefined) sceneProgress.status = options.sceneStatus;

    if (Object.keys(sceneProgress).length > 0) {
      data.stageProgress = JSON.stringify(sceneProgress);
    }

    await prisma.renderJob.update({
      where: { id: renderJobId },
      data,
    });
  } catch {
    // Non-fatal: progress updates should never block rendering
  }
}

/**
 * Run edge_tts via spawn with array args (NO shell, NO string interpolation).
 * Prevents command injection from untrusted voiceoverText.
 */
function runEdgeTTS(
  pythonCmd: string,
  text: string,
  voice: string,
  outputFile: string,
  timeoutMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      pythonCmd,
      ["-m", "edge_tts", "--voice", voice, "--rate", "+0%", "--text", text, "--write-media", outputFile],
      { stdio: ["ignore", "ignore", "pipe"], windowsHide: true }
    );

    let stderrBuf = "";
    child.stderr?.on("data", (b) => (stderrBuf += b.toString()));

    const killTimer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);

    child.on("error", (err) => {
      clearTimeout(killTimer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(killTimer);
      if (code === 0) resolve();
      else reject(new Error(`edge_tts exited ${code}: ${stderrBuf.slice(0, 500)}`));
    });
  });
}

/**
 * Determine if a scene is suitable for MG (Motion Graphics) animation display.
 * MG is appropriate for: data/statistics, comparisons, lists, abstract concepts.
 * MG is NOT appropriate for: narrative scenes, historical events, character actions.
 */
function isMGAnimationScene(sceneType: string, voiceoverText: string): boolean {
  // Scene explicitly marked as ANIMATION
  if (sceneType === "ANIMATION") return true;

  // Check for data-heavy content patterns
  const dataPatterns = [
    /占.*分之/,           // "占全球三分之一"
    /\d+\.?\d*[万亿亿]/,  // Large numbers (GDP, population)
    /对比|比较|VS|vs/,     // Comparisons
    /排名|排行|TOP|Top/,   // Rankings
    /比例|占比|百分比|％/,  // Percentages
    /增长了?|下降了?|翻了?/, // Growth/decline
  ];
  let dataScore = 0;
  for (const p of dataPatterns) {
    if (p.test(voiceoverText)) dataScore++;
  }

  // Must have at least 2 data indicators to qualify as MG-worthy
  // Single number mentions (like "27年") are not enough — they're narrative context
  if (dataScore >= 2) return true;

  return false;
}

/**
 * Extract key data points (numbers with context) from voiceover text.
 * E.g., "170艘战船" → { number: "170", unit: "艘战船" }
 * E.g., "19次" → { number: "19", unit: "次" }
 * E.g., "两个半世纪" → { number: "2.5", unit: "世纪" }
 */
function extractDataPoints(text: string): Array<{ number: string; unit: string }> {
  const results: Array<{ number: string; unit: string }> = [];

  // Pattern 1: Arabic numbers with Chinese measure word (e.g., "170艘", "19次", "645年")
  // Match: number + 1-2 char measure/unit word
  const mw = "艘|次|年|人|个|万|亿|朝|代|国|部|战|条|座|件|场|位|名|期|届|批|项|种|倍|分|秒|里|米|亩|斤|吨|度|升|段|级|层|步|回|番|阵|局|行|群|队|军|师|旅|团|营|户|家|间|栋|城|镇|村|县|省|洲|岛|山|河|湖|海|桥|路|门|塔|寺|宫|殿|园|田|地|井|池|站|厂|炉|钟|鼓|旗|碑|像|画|书|信|令|法|税|银|粮|兵|马|车|船|炮|剑|弓|盾|甲|歌|诗|词|文|章|字|页|编|版";
  const arabicMatches = text.match(new RegExp(`\\d+\\.?\\d*(?:${mw})`, "g"));
  if (arabicMatches) {
    for (const m of arabicMatches.slice(0, 4)) {
      const numMatch = m.match(/^(\d+\.?\d*)(.{1,4})/);
      if (numMatch && numMatch[1].length <= 6) {
        results.push({ number: numMatch[1], unit: numMatch[2] });
      }
    }
  }

  // Pattern 2: Chinese number expressions (e.g., "两个半世纪", "四战", "百余人")
  const chineseNumMap: Record<string, string> = {
    "一": "1", "二": "2", "两": "2", "三": "3", "四": "4", "五": "5",
    "六": "6", "七": "7", "八": "8", "九": "9", "十": "10",
    "百": "100", "千": "1000", "万": "10000",
  };
  // Match "X个/次/年/世纪/人/艘/朝/代/国" patterns
  const cnMatches = text.match(/[一两二三四五六七八九十百千万]+(?:个|次|年|世纪|人|艘|朝|代|国|州|部|篇|卷|战)/g);
  if (cnMatches) {
    for (const m of [...new Set(cnMatches)].slice(0, 2)) {
      const firstChar = m[0];
      if (chineseNumMap[firstChar]) {
        results.push({ number: chineseNumMap[firstChar], unit: m.slice(1) });
      }
    }
  }

  // Pattern 3: Year/era references (e.g., "663年", "630年", "710年")
  const yearMatches = text.match(/\d{3,4}年/g);
  if (yearMatches && results.length < 3) {
    for (const y of [...new Set(yearMatches)].slice(0, 2)) {
      const yearNum = y.replace("年", "");
      results.push({ number: yearNum, unit: "年" });
    }
  }

  return results.slice(0, 3); // Max 3 data points per scene
}

/**
 * Build FFmpeg drawtext filter chain for MG animation data highlights.
 * Displays extracted numbers as large, glowing text with unit labels below.
 */
function buildMGDataDrawText(
  dataPoints: Array<{ number: string; unit: string }>,
  w: number,
  h: number,
  fontPath: string,
): string {
  if (dataPoints.length === 0) return "";

  const filters: string[] = [];
  const centerX = Math.round(w / 2);
  const centerY = Math.round(h / 2);

  if (dataPoints.length === 1) {
    // Single data point: large centered number
    const dp = dataPoints[0];
    const safeNum = dp.number.replace(/['"\\:;%]/g, "");
    const safeUnit = dp.unit.replace(/['"\\:;%]/g, "");
    filters.push(
      `drawtext=fontfile='${fontPath}':fontsize=120:fontcolor=white@0.9:x=(w-text_w)/2:y=${centerY - 80}:text='${safeNum}':enable='gt(t,0.5)'`,
      `drawtext=fontfile='${fontPath}':fontsize=36:fontcolor=white@0.5:x=(w-text_w)/2:y=${centerY + 60}:text='${safeUnit}':enable='gt(t,0.8)'`,
    );
  } else if (dataPoints.length === 2) {
    // Two data points: side by side
    const leftX = Math.round(w * 0.25);
    const rightX = Math.round(w * 0.75);
    for (let idx = 0; idx < 2; idx++) {
      const dp = dataPoints[idx];
      const safeNum = dp.number.replace(/['"\\:;%]/g, "");
      const safeUnit = dp.unit.replace(/['"\\:;%]/g, "");
      const xPos = idx === 0 ? leftX : rightX;
      filters.push(
        `drawtext=fontfile='${fontPath}':fontsize=90:fontcolor=white@0.9:x=${xPos}-text_w/2:y=${centerY - 70}:text='${safeNum}':enable='gt(t,${0.5 + idx * 0.5})'`,
        `drawtext=fontfile='${fontPath}':fontsize=28:fontcolor=white@0.5:x=${xPos}-text_w/2:y=${centerY + 40}:text='${safeUnit}':enable='gt(t,${0.8 + idx * 0.5})'`,
      );
    }
  } else {
    // Three data points: top-center, bottom-left, bottom-right
    for (let idx = 0; idx < 3; idx++) {
      const dp = dataPoints[idx];
      const safeNum = dp.number.replace(/['"\\:;%]/g, "");
      const safeUnit = dp.unit.replace(/['"\\:;%]/g, "");
      let xPos: number, yPos: number;
      if (idx === 0) { xPos = centerX; yPos = centerY - 120; }
      else if (idx === 1) { xPos = Math.round(w * 0.3); yPos = centerY + 30; }
      else { xPos = Math.round(w * 0.7); yPos = centerY + 30; }
      filters.push(
        `drawtext=fontfile='${fontPath}':fontsize=72:fontcolor=white@0.85:x=${xPos}-text_w/2:y=${yPos}:text='${safeNum}':enable='gt(t,${0.5 + idx * 0.4})'`,
        `drawtext=fontfile='${fontPath}':fontsize=24:fontcolor=white@0.45:x=${xPos}-text_w/2:y=${yPos + 80}:text='${safeUnit}':enable='gt(t,${0.8 + idx * 0.4})'`,
      );
    }
  }

  return filters.join(",");
}

/**
 * Extract table-structured data from voiceover text.
 * Detects comparison patterns (A vs B), lists, and structured facts.
 * Returns null if no table structure is detected.
 */
interface TableRow {
  label: string;
  values: string[];
}
interface TableData {
  headers: string[];   // Column headers (e.g., ["", "明朝", "清朝"])
  rows: TableRow[];    // Data rows (e.g., [{label: "官员自称", values: ["臣", "奴才"]}])
}

function extractTableData(text: string): TableData | null {
  // Pattern 1: Explicit A vs B comparison (e.g., "明朝...清朝..." or "A是X，B是Y")
  const comparisonPairs: string[][] = [
    ["明朝", "清朝"], ["明", "清"], ["大明", "大清"],
    ["唐", "宋"], ["唐", "明"], ["中国", "日本"],
    ["古代", "现代"], ["过去", "现在"],
  ];

  for (const [left, right] of comparisonPairs) {
    if (text.includes(left) && text.includes(right)) {
      const rows: TableRow[] = [];

      // Strategy: Split text into sentences, find pairs with same structure
      const sentences = text.split(/[，。；！？]/).filter(s => s.trim());
      const leftSentences = sentences.filter(s => s.includes(left));
      const rightSentences = sentences.filter(s => s.includes(right));

      // Match paired sentences: each left sentence matches best right sentence
      const usedRightIdx = new Set<number>();
      for (const ls of leftSentences) {
        let bestScore = -1;
        let bestRow: TableRow | null = null;
        let bestRIdx = -1;
        for (let ri = 0; ri < rightSentences.length; ri++) {
          if (usedRightIdx.has(ri)) continue;
          const rs = rightSentences[ri];
          const leftPart = ls.replace(new RegExp(`.*${left}`, "g"), "").replace(/[的了是有都也会被把让向给从]/g, "").trim();
          const rightPart = rs.replace(new RegExp(`.*${right}`, "g"), "").replace(/[的了是有都也会被把让向给从]/g, "").trim();
          if (leftPart && rightPart && leftPart !== rightPart
              && leftPart.length >= 2 && leftPart.length <= 10
              && rightPart.length >= 2 && rightPart.length <= 10) {
            const lenDiff = Math.abs(leftPart.length - rightPart.length);
            if (lenDiff <= 2) {
              const score = 10 - lenDiff;
              if (score > bestScore) {
                bestScore = score;
                bestRow = { label: "", values: [leftPart, rightPart] };
                bestRIdx = ri;
              }
            }
          }
        }
        if (bestRow && rows.length < 4) {
          usedRightIdx.add(bestRIdx);
          rows.push(bestRow);
        }
      }

      if (rows.length >= 2) {
        return {
          headers: ["", left, right],
          rows,
        };
      }
    }
  }

  // Pattern 2: Numbered/bulleted list (3+ items)
  // e.g., "政治上...经济上...文化上..." or "第一...第二...第三..."
  const aspectPatterns = text.match(/(?:政治|经济|文化|军事|外交|科技|教育|法律|社会|制度|思想|艺术)[上中方面]/g);
  if (aspectPatterns && aspectPatterns.length >= 3) {
    const uniqueAspects = [...new Set(aspectPatterns)];
    const rows: TableRow[] = [];
    for (const aspect of uniqueAspects.slice(0, 4)) {
      // Extract the content after the aspect keyword
      const aspectRegex = new RegExp(`${aspect}[，：:]?([^，。；！？]{2,12})`, "g");
      const contentMatch = aspectRegex.exec(text);
      if (contentMatch) {
        const content = contentMatch[1].replace(/[的了是有都也会被把让向给从]/g, "").trim();
        if (content) rows.push({ label: aspect, values: [content] });
      }
    }
    if (rows.length >= 2) {
      return {
        headers: ["领域", "内容"],
        rows,
      };
    }
  }

  // Pattern 3: Multiple data points with same unit → comparison table
  const dataPoints = extractDataPoints(text);
  if (dataPoints.length >= 3) {
    const sameUnit = dataPoints.filter(dp => dp.unit === dataPoints[0].unit);
    if (sameUnit.length >= 3) {
      return {
        headers: ["序号", dataPoints[0].unit],
        rows: sameUnit.slice(0, 4).map((dp, i) => ({
          label: `${i + 1}`,
          values: [dp.number],
        })),
      };
    }
  }

  return null;
}

/**
 * Build FFmpeg filter chain for table-style MG animation.
 * Uses drawbox for table borders + drawtext for cell content.
 */
function buildMGTableDrawText(
  table: TableData,
  w: number,
  h: number,
  fontPath: string,
): string {
  const filters: string[] = [];
  const numCols = table.headers.length;
  const numRows = table.rows.length + 1; // +1 for header

  // Table dimensions
  const tableW = Math.min(Math.round(w * 0.7), 1200);
  const tableH = Math.min(Math.round(h * 0.5), numRows * 80 + 40);
  const tableX = Math.round((w - tableW) / 2);
  const tableY = Math.round((h - tableH) / 2);
  const colW = Math.round(tableW / numCols);
  const rowH = Math.round(tableH / numRows);

  // Draw table background (semi-transparent dark box)
  filters.push(
    `drawbox=x=${tableX}:y=${tableY}:w=${tableW}:h=${tableH}:color=0x0f3460@0.7:t=fill:enable='gt(t,0.3)'`,
  );

  // Draw header row background (slightly lighter)
  filters.push(
    `drawbox=x=${tableX}:y=${tableY}:w=${tableW}:h=${rowH}:color=0x1a5276@0.8:t=fill:enable='gt(t,0.3)'`,
  );

  // Draw table border
  filters.push(
    `drawbox=x=${tableX}:y=${tableY}:w=${tableW}:h=${tableH}:color=white@0.3:t=2:enable='gt(t,0.3)'`,
  );

  // Draw horizontal lines for each row
  for (let r = 1; r < numRows; r++) {
    const lineY = tableY + r * rowH;
    filters.push(
      `drawbox=x=${tableX}:y=${lineY}:w=${tableW}:h=1:color=white@0.2:t=fill:enable='gt(t,0.3)'`,
    );
  }

  // Draw vertical lines for each column
  for (let c = 1; c < numCols; c++) {
    const lineX = tableX + c * colW;
    filters.push(
      `drawbox=x=${lineX}:y=${tableY}:w=1:h=${tableH}:color=white@0.2:t=fill:enable='gt(t,0.3)'`,
    );
  }

  // Draw header text
  for (let c = 0; c < numCols; c++) {
    const header = table.headers[c].replace(/['"\\:;%]/g, "");
    if (!header) continue;
    const cellX = tableX + c * colW + Math.round(colW / 2);
    const cellY = tableY + Math.round(rowH / 2) - 12;
    filters.push(
      `drawtext=fontfile='${fontPath}':fontsize=28:fontcolor=white@0.9:x=${cellX}-text_w/2:y=${cellY}:text='${header}':enable='gt(t,0.5)'`,
    );
  }

  // Draw data rows with staggered animation
  for (let r = 0; r < table.rows.length; r++) {
    const row = table.rows[r];
    const rowY = tableY + (r + 1) * rowH;
    const delay = 0.8 + r * 0.4;

    // Row label (first column)
    if (row.label) {
      const safeLabel = row.label.replace(/['"\\:;%]/g, "");
      const cellX = tableX + Math.round(colW / 2);
      const cellY = rowY + Math.round(rowH / 2) - 12;
      filters.push(
        `drawtext=fontfile='${fontPath}':fontsize=24:fontcolor=white@0.7:x=${cellX}-text_w/2:y=${cellY}:text='${safeLabel}':enable='gt(t,${delay})'`,
      );
    }

    // Row values (remaining columns)
    for (let c = 0; c < row.values.length; c++) {
      const safeVal = row.values[c].replace(/['"\\:;%]/g, "");
      if (!safeVal) continue;
      const cellX = tableX + (c + 1) * colW + Math.round(colW / 2);
      const cellY = rowY + Math.round(rowH / 2) - 12;
      // Highlight with accent color for contrast values
      const color = (numCols === 3 && c === 1) ? "0x5dade2@0.95" : "0xf39c12@0.95";
      filters.push(
        `drawtext=fontfile='${fontPath}':fontsize=24:fontcolor=${color}:x=${cellX}-text_w/2:y=${cellY}:text='${safeVal}':enable='gt(t,${delay + 0.2})'`,
      );
    }
  }

  return filters.join(",");
}

/** Result of a TTS attempt — non-fatal errors are reported as `ok:false` with a reason. */
interface TtsResult {
  ok: boolean;
  reason?: string;
}

/**
 * Try multiple Python paths for edge_tts. The actual subprocess is run via
 * `runEdgeTTS` (spawn with array args), so the user-controlled `text` is
 * never interpolated into a shell command — this is the fix for the
 * command-injection issue.
 *
 * Returns `{ ok: true }` only when the output file exists and is non-empty.
 * Otherwise returns `{ ok: false, reason }` so the caller can fall back to
 * a silent-track without aborting the whole render.
 */
async function generateTTS(text: string, voice: string, outputFile: string): Promise<TtsResult> {
  const pythonPaths = ["python", "python3"];
  const errors: string[] = [];

  for (const py of pythonPaths) {
    try {
      await runEdgeTTS(py, text, voice, outputFile, 60000);
      try {
        const stat = await import("fs/promises").then(m => m.stat(outputFile));
        if (stat.size > 100) return { ok: true };
        errors.push(`${py}: file too small (${stat.size}B)`);
      } catch (statErr: any) {
        errors.push(`${py}: ${statErr?.message || "no output file"}`);
      }
    } catch (err: any) {
      errors.push(`${py}: ${err?.message?.slice(0, 120) || "unknown"}`);
      continue;
    }
  }
  return { ok: false, reason: errors.join(" | ") || "edge_tts produced no audio" };
}

async function getAudioDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], { timeout: 5000 });
    const duration = parseFloat(stdout.trim());
    return isNaN(duration) ? 0 : duration;
  } catch {
    return 0;
  }
}

export interface RenderConfig {
  width: number;
  height: number;
  fps: number;
  format: string;
}

const ASPECT_CONFIGS: Record<string, RenderConfig> = {
  W_16_9: { width: 1920, height: 1080, fps: 30, format: "mp4" },
  W_9_16: { width: 1080, height: 1920, fps: 30, format: "mp4" },
  W_1_1: { width: 1080, height: 1080, fps: 30, format: "mp4" },
};

export function getRenderConfig(aspectRatio: string): RenderConfig {
  return ASPECT_CONFIGS[aspectRatio] || ASPECT_CONFIGS.W_16_9;
}

// Inline render - no Redis/BullMQ dependency
export async function renderProjectInline(
  projectId: string,
  userId: string
): Promise<{ outputUrl: string; duration: number }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      storyboard: {
        include: {
          scenes: { orderBy: { sceneNumber: "asc" } },
        },
      },
      musicTracks: { where: { isBgm: true }, take: 1 },
    },
  });

  if (!project) throw new Error("Project not found");
  if (!project.storyboard) throw new Error("Storyboard not found");
  if (project.storyboard.scenes.length === 0) throw new Error("No scenes");

  const config = getRenderConfig(project.aspectRatio);
  const scenes = project.storyboard.scenes;

  // Create render job record
  const renderJob = await prisma.renderJob.create({
    data: {
      projectId,
      userId,
      status: "PREPARING",
      config: JSON.stringify({ ...config, sceneCount: scenes.length }),
      startedAt: new Date(),
    },
  });

  // Declared outside try so catch block so catch block can also clean up workDir
  let workDir = "";
  try {
    // Ensure project is in a valid state for rendering
    // The caller (render API route) may have already transitioned to RENDERING,
    // so we handle both cases: already RENDERING, or needs transition from DRAFT/COMPLETED
    const projectStatus = await prisma.project.findUnique({
      where: { id: projectId },
      select: { status: true },
    });

    const currentStatus = projectStatus?.status;
    if (currentStatus === "RENDERING") {
      console.log(`[Render] Project already in RENDERING state, continuing...`);
    } else if (currentStatus === "COMPLETED") {
      // Allow re-rendering from completed state
      await transitionProject(projectId, userId, "RENDERING");
      console.log(`[Render] Re-transitioned COMPLETED → RENDERING`);
    } else if (currentStatus === "DRAFT") {
      // Normal flow: transition to rendering
      await transitionProject(projectId, userId, "RENDERING");
      console.log(`[Render] Transitioned ${currentStatus} → RENDERING`);
    } else {
      throw new Error(`Cannot start render: invalid state ${currentStatus}`);
    }

    // Append a random suffix so simultaneous renders of the same project
    // (e.g. a retry triggered while a previous run is still cleaning up,
    // or multiple worker replicas) cannot clobber each other's working
    // files. The directory is still scoped to the project for debuggability.
    workDir = join(tmpdir(), `render-${projectId}-${randomUUID()}`);
    await mkdir(workDir, { recursive: true });

    // TTS stage — for ai_video mode this is merged into the materials pass
    // so each scene's TTS runs in parallel with its AI generation.
    const isAiVideoMode = project.renderMode === "ai_video";
    const ttsWarnings: string[] = [];
    const ttsDurationMap = new Map<number, number>();
    const needTtsStage = !isAiVideoMode;
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (needTtsStage) {
    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: { status: "TTS_GENERATING", currentStage: "tts" },
    });

    const isMiMo = user?.ttsProvider === "mimo";
    const edgeVoice = user?.ttsVoice || "zh-CN-YunxiNeural";

    // TTS with concurrency — higher parallelism for faster generation.
    // Previous conservative limit (2 on Windows) caused sequential bottlenecks.
    // Edge TTS is I/O-bound (HTTP API calls), not CPU-bound, so 4-5 concurrent
    // calls are safe even on Windows. Rate-limiting is handled by edge_tts itself.
    const TTS_CONCURRENCY = process.platform === "win32" ? 4 : 5;
    // Collect non-fatal warnings so we can persist them on RenderJob.errorMessage
    // and the affected Scene.renderWarning. We do NOT abort the whole render.
    const ttsResults = await mapConcurrent(scenes, TTS_CONCURRENCY, async (scene, i) => {
      const audioFile = join(workDir, `tts-${i}.mp3`);

      // Skip TTS only if audioUrl exists AND the file is still on disk
      if (scene.audioUrl) {
        try {
          const stat = await import("fs/promises").then(m => m.stat(audioFile));
          if (stat.size > 100) {
            // Verify it's a valid audio file by probing duration
            const dur = await getAudioDuration(audioFile);
            if (dur > 0) return { index: i, audioFile, duration: dur };
          }
        } catch {
          console.warn(`[Render] Scene ${i} audioUrl set but file missing/invalid, regenerating TTS`);
        }
      }
      const estimatedDuration = estimateAudioDuration(scene.voiceoverText);

      if (isMiMo) {
        // MiMo TTS
        const mimoVoice = user?.ttsVoice || "冰糖";
        // The stored value may be encrypted; fall back to env if decryption fails.
        const mimoApiKey =
          decryptSecret(user?.aiApiKey) ||
          process.env.MIMO_API_KEY ||
          "";
        const mimoBaseUrl = user?.aiBaseUrl || "https://token-plan-cn.xiaomimimo.com/v1";
        const res = await fetch(`${mimoBaseUrl}/chat/completions`, {
          method: "POST",
          headers: { "api-key": mimoApiKey, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "mimo-v2.5-tts",
            messages: [{ role: "assistant", content: scene.voiceoverText }],
            audio: { format: "wav", voice: mimoVoice },
          }),
        });
        let mimoOk = false;
        if (res.ok) {
          const data = await res.json();
          const audioData = data.choices?.[0]?.message?.audio?.data;
          if (audioData) {
            await writeFile(audioFile, Buffer.from(audioData, "base64"));
            mimoOk = true;
          }
        }
        if (!mimoOk) {
          const warnMsg = `MiMo TTS failed for scene ${i} — using silent audio (${estimatedDuration.toFixed(1)}s)`;
          console.warn(`[Render] ${warnMsg}`);
          ttsWarnings.push(`Scene #${scene.sceneNumber}: ${warnMsg}`);
          try {
            await prisma.scene.update({
              where: { id: scene.id },
              data: { renderWarning: "TTS generation failed — silent audio inserted as fallback" },
            }).catch(() => {});
          } catch {}
          try {
            await execFileAsync("ffmpeg", [
              "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
              "-t", String(estimatedDuration), "-c:a", "libmp3lame", "-b:a", "128k", audioFile,
            ], { timeout: 10000 });
          } catch (ffErr) {
            console.error(`[Render] Silent audio fallback failed for scene ${i}:`, ffErr);
            // Last resort: generate WAV silence, then convert to MP3
            const sampleRate = 44100;
            const channels = 2;
            const bytesPerSample = 2;
            const numSamples = Math.ceil(estimatedDuration * sampleRate);
            const dataSize = numSamples * channels * bytesPerSample;
            const wav = Buffer.alloc(44 + dataSize);
            wav.write("RIFF", 0);
            wav.writeUInt32LE(36 + dataSize, 4);
            wav.write("WAVE", 8);
            wav.write("fmt ", 12);
            wav.writeUInt32LE(16, 16);
            wav.writeUInt16LE(1, 20); // PCM
            wav.writeUInt16LE(channels, 22);
            wav.writeUInt32LE(sampleRate, 24);
            wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
            wav.writeUInt16LE(channels * bytesPerSample, 32);
            wav.writeUInt16LE(16, 34);
            wav.write("data", 36);
            wav.writeUInt32LE(dataSize, 40);
            const wavFile = audioFile.replace(/\.mp3$/, ".wav");
            await writeFile(wavFile, wav).catch(() => {});
            try {
              await execFileAsync("ffmpeg", [
                "-y", "-i", wavFile, "-c:a", "libmp3lame", "-b:a", "128k", audioFile,
              ], { timeout: 10000 });
            } catch {
              // If MP3 conversion fails, use WAV directly — rename input
              await writeFile(audioFile, wav).catch(() => {});
            }
          }
        }
      } else {
        // Edge TTS with shell-based Python detection
        const ttsResult = await generateTTS(scene.voiceoverText, edgeVoice, audioFile);
        if (!ttsResult.ok) {
          const warnMsg = `Edge TTS failed for scene ${i} — using silent audio (${estimatedDuration.toFixed(1)}s). Reason: ${ttsResult.reason}`;
          console.warn(`[Render] ${warnMsg}`);
          ttsWarnings.push(`Scene #${scene.sceneNumber}: ${warnMsg}`);
          try {
            await prisma.scene.update({
              where: { id: scene.id },
              data: { renderWarning: "TTS generation failed — silent audio inserted as fallback" },
            }).catch(() => {});
          } catch {}
          try {
            await execFileAsync("ffmpeg", [
              "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
              "-t", String(estimatedDuration), "-c:a", "libmp3lame", "-b:a", "128k", audioFile,
            ], { timeout: 10000 });
          } catch (ffErr) {
            console.error(`[Render] Silent audio fallback failed for scene ${i}:`, ffErr);
            // Last resort: generate proper silent WAV of correct duration
            const sampleRate = 44100;
            const channels = 2;
            const bytesPerSample = 2;
            const numSamples = Math.ceil(estimatedDuration * sampleRate);
            const dataSize = numSamples * channels * bytesPerSample;
            const headerSize = 44;
            const wav = Buffer.alloc(headerSize + dataSize);
            // WAV header
            wav.write("RIFF", 0);
            wav.writeUInt32LE(36 + dataSize, 4);
            wav.write("WAVE", 8);
            wav.write("fmt ", 12);
            wav.writeUInt32LE(16, 16);
            wav.writeUInt16LE(1, 20); // PCM
            wav.writeUInt16LE(channels, 22);
            wav.writeUInt32LE(sampleRate, 24);
            wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
            wav.writeUInt16LE(channels * bytesPerSample, 32);
            wav.writeUInt16LE(16, 34);
            wav.write("data", 36);
            wav.writeUInt32LE(dataSize, 40);
            // samples are already zero (silence)
            const { writeFile } = await import("fs/promises");
            const wavFile = audioFile.replace(/\.mp3$/, ".wav");
            await writeFile(wavFile, wav).catch(() => {});
            // Convert WAV to MP3 for consistent pipeline
            try {
              await execFileAsync("ffmpeg", [
                "-y", "-i", wavFile, "-c:a", "libmp3lame", "-b:a", "128k", audioFile,
              ], { timeout: 10000 });
            } catch {
              // If MP3 conversion fails, use WAV directly — rename input
              await writeFile(audioFile, wav).catch(() => {});
            }
          }
        }
      }

      // Verify TTS output and get actual duration
      let actualDuration = 0;
      try {
        const stat = await import("fs/promises").then(m => m.stat(audioFile));
        if (stat.size < 100) {
          throw new Error("TTS output file too small");
        }
        actualDuration = await getAudioDuration(audioFile);
      } catch {}
      if (actualDuration <= 0) {
        actualDuration = estimateAudioDuration(scene.voiceoverText);
      }

      await prisma.scene.update({
        where: { id: scene.id },
        data: { audioUrl: audioFile, audioDuration: actualDuration },
      });

      return { index: i, audioFile, duration: actualDuration };
    });

    // Build per-scene TTS durations (populated by TTS stage or inline AI-mode TTS)
    for (const result of ttsResults) {
      if (result) ttsDurationMap.set(result.index, result.duration);
    }

    // Persist TTS warnings to RenderJob so users can see them in the UI
    // (the render still completes — these are non-fatal — but no longer silent).
    if (ttsWarnings.length > 0) {
      try {
        await prisma.renderJob.update({
          where: { id: renderJob.id },
          data: { errorMessage: `[TTS warnings — ${ttsWarnings.length} scene(s) fell back to silent audio]\n${ttsWarnings.join("\n")}` },
        });
      } catch (err) {
        console.warn(`[Render] Failed to persist TTS warnings to RenderJob:`, err);
      }
    }
    } // end needTtsStage

    // Materials stage
    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: { status: "MATERIALS_LOADING", currentStage: "materials" },
    });

    // In ai_video mode, clear any stale materialIds from AI_GENERATED scenes
    // that may have been assigned by a previous stock-mode render. This
    // ensures AI and stock modes are fully separated — AI scenes never
    // reference external (B站/Pexels) materials.
    if (project.renderMode === "ai_video") {
      const aiSceneIds = scenes
        .filter(s => s.sceneType === "AI_GENERATED" && s.materialId)
        .map(s => s.id);
      if (aiSceneIds.length > 0) {
        await prisma.scene.updateMany({
          where: { id: { in: aiSceneIds } },
          data: { materialId: null },
        });
        console.log(`[Render] Cleared ${aiSceneIds.length} stale materialIds from AI_GENERATED scenes`);
        // Also update the in-memory scene objects
        for (const s of scenes) {
          if (s.sceneType === "AI_GENERATED") s.materialId = null;
        }
      }
    }

    // Materials stage with concurrency.
    // ai_video mode: AI generation is network-bound (waiting on Agnes API),
    //   so we can safely raise concurrency to parallelize more scenes.
    // stock mode: Bilibili downloads are bandwidth-bound, keep lower concurrency.
    // AI generation is pure network I/O with no local CPU contention.
    // All scenes are independent (different prompts) — fire them all at once,
    // compose in order at the end. Bilibili stays at 4 to avoid rate-limiting.
    const MATERIALS_CONCURRENCY = isAiVideoMode ? scenes.length : 4;
    console.log(`[Render] Materials concurrency: ${MATERIALS_CONCURRENCY} (renderMode=${project.renderMode})`);
    await mapConcurrent(scenes, MATERIALS_CONCURRENCY, async (scene, i) => {
      console.log(`[Render] Scene ${i}: sceneType=${scene.sceneType || "(none)"}, materialId=${scene.materialId || "(none)"}`);
      const materialFile = join(workDir, `scene-${i}.mp4`);
      let materialLoaded = false;

      // Inline TTS for ai_video mode — runs in parallel with AI generation
      // to eliminate the separate TTS stage overhead (~15s saved per render).
      const audioFile = join(workDir, `tts-${i}.mp3`);
      if (isAiVideoMode) {
        const estimatedDuration = estimateAudioDuration(scene.voiceoverText);
        const edgeVoice = user?.ttsVoice || "zh-CN-YunxiNeural";
        try {
          await execFileAsync("python", [
            "-m", "edge_tts", "--voice", edgeVoice, "--rate", "+0%",
            "--text", scene.voiceoverText, "--write-media", audioFile,
          ], { timeout: 60000 });
          const dur = await getAudioDuration(audioFile);
          if (dur > 0) { ttsDurationMap.set(i, dur); }
        } catch (ttsErr: any) {
          const warnMsg = `AI-mode TTS failed for scene ${i} (${ttsErr.message?.slice(0, 50)})`;
          console.warn(`[Render] ${warnMsg}`);
          ttsWarnings.push(warnMsg);
          // Generate silent fallback so compose has a valid audio file
          await execFileAsync("ffmpeg", [
            "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-t", String(estimatedDuration), "-c:a", "libmp3lame", "-b:a", "128k", audioFile,
          ], { timeout: 10000 });
          ttsDurationMap.set(i, estimatedDuration);
        }
      }

      // Parse production meta (used by both auto-search and download)
      let meta: any = null;
      if (scene.productionMeta) {
        try { meta = JSON.parse(scene.productionMeta as string); } catch {}
      }
      const sourceVideos: string[] = (meta?.sourceVideos || []).map((sv: string) => {
        // Clean sourceVideo names: remove parenthetical annotations like "（文化氛围）"
        // "长安十二时辰（文化氛围）" → "长安十二时辰"
        return sv.replace(/[（(][^）)]*[）)]/g, "").trim();
      }).filter((sv: string) => sv.length >= 2);
      const materialQuery = meta?.materialQuery || scene.materialQuery || "";
      const materialQueryEn = meta?.materialQueryEn || "";
      const visualDesc = meta?.visualDesc || scene.visualDesc || "";

      // Parse project-level material requirements
      let projectMaterialReqs: {
        contentSummary?: string;
        referenceStyle?: string;
        requiredSources?: string[];
        preferredSources?: string[];
        materialTypes?: string[];
        properNouns?: string[];
        landmarkScenes?: string[];
        stylePreference?: string;
        timeLimit?: string;
        regionLimit?: string;
        avoidKeywords?: string[];
      } | null = null;
      if (project.materialRequirements) {
        try { projectMaterialReqs = JSON.parse(project.materialRequirements); } catch {}
      }

      // Merge: requiredSources take priority over AI-generated sourceVideos
      const effectiveSources = [
        ...(projectMaterialReqs?.requiredSources || []),
        ...sourceVideos.filter(sv => !(projectMaterialReqs?.requiredSources || []).includes(sv)),
      ];
      const preferredSources = projectMaterialReqs?.preferredSources || [];
      const properNouns = projectMaterialReqs?.properNouns || [];
      const landmarkScenes = projectMaterialReqs?.landmarkScenes || [];
      const avoidKeywords = [
        ...(projectMaterialReqs?.avoidKeywords || []),
        // Auto-add region limit keywords
        ...(projectMaterialReqs?.regionLimit?.includes("现代") ? ["现代", "都市", "城市", "高楼", "商场", "地铁"] : []),
      ];

      // ── Auto-search materials from Bilibili if none attached ──
      /**
       * autoSearchBilibili — multi-phase Bilibili material search pipeline.
       *
       * Phases (in priority order):
       *   0. Required sources (user-specified, MUST appear)
       *   1. AI-recommended sourceVideos (high precision: "剧名 片段")
       *   1.5 Preferred sources (user preferences)
       *   2. Visual keywords from visualDesc (no show name bias)
       *   2.5 properNouns from user requirements
       *   2.8 landmarkScenes from user requirements
       *   3. materialQuery (short version, 15 chars max)
       *   4. Voiceover text keywords (fallback)
       *   5. properNouns + era fallback
       *
       * For each phase:
       *   - Build search queries → execute via shared searchBilibiliVideos()
       *   - Apply negative keyword filter (context-aware: relaxed for KNOWLEDGE)
       *   - Filter by duration (300s cap with sources, 600s without)
       *   - Probe resolution, check aspect ratio (≥1.2 for landscape)
       *
       * Selection: prefer title-matched candidates; fallback to any valid result.
       * On failure: Pexels fallback → MG animation (data scenes) → dark bg.
       *
       * @returns true if a material was found and assigned
       */
      async function autoSearchBilibili(): Promise<boolean> {
        try {
          // ── Build prioritized search queries ──
          // KEY PRINCIPLE: Keep search queries SHORT (2-4 words max).
          // Bilibili search engine works best with concise keywords.
          // Long queries like "长安十二时辰 正片 日本贵族吟诵汉诗 唐招提寺 空镜" return garbage.
          // Instead: "长安十二时辰 片段" or "唐招提寺 空镜"
          const searchQueries: { query: string; label: string; requireTitleMatch?: string }[] = [];

          // ── Extract keywords from materialQuery FIRST ──
          // materialQuery is the AI's distilled search term — extract its parts
          // for use in both visual keyword scoring and search query construction.
          const mqKeywords: string[] = [];
          if (materialQuery) {
            const parts = materialQuery.split(/[\s,，、]+/).filter((p: string) => p.length >= 2 && p.length <= 8);
            mqKeywords.push(...parts.slice(0, 3));
          }

          // ── Extract core visual keywords from visualDesc ──
          // This is the MOST IMPORTANT step for matching footage to scene descriptions.
          // We extract concrete, searchable terms from the visual description.
          // Keywords are categorized as: subject (人物), scene (场景), action (动作)
          // for better search query construction and later relevance scoring.
          const visualKeywords: string[] = [];
          // All unique keywords from visualDesc — used for relevance scoring in Step 2
          const allVisualKeywords: string[] = [];
          if (visualDesc) {
            // Pattern 1: Scene/location nouns (most searchable)
            const locationNouns = visualDesc.match(/(?:紫禁城|太和殿|朝堂|宫殿|宫门|龙椅|金銮殿|御书房|后宫|考场|城墙|战场|军营|书房|大殿|殿内|殿外|金銮|太庙|天坛|颐和园|圆明园|长城|运河|科举考场|港口|码头|海面|江面|船队|战船|帆船|寺庙|佛寺|古寺|宫殿|皇城|城门|城楼|城墙|街道|集市|朝堂|宫殿|大殿|龙椅|御花园|庭院|和室|茶室|书院|学堂|战场|军营|营地|阵前|城下|护城河|运河|河道|港口|码头|船厂|船坞|海面|江面|湖面|河面|大海|大洋|海峡|海湾|山崖|山顶|山间|山路|平原|草原|沙漠|戈壁|森林|竹林|花园|园林|楼阁|亭台|塔|桥|牌坊|坊门|朱雀门|朱雀大街|棋盘式|东西市|坊|市|平城京|奈良|长安|洛阳|开封|临安|北京|南京)/g) as string[] | null;
            if (locationNouns) visualKeywords.push(...[...new Set(locationNouns)].slice(0, 4));

            // Pattern 2: Character/action keywords (2-4 chars, very specific)
            // Extract concrete visual actions like "遣唐使渡海", "朝堂议事", "跪拜", "吟诗"
            const actionPatterns = visualDesc.match(/[\u4e00-\u9fff]{2,4}(?:渡海|出海|航行|登船|跪拜|叩首|跪坐|端坐|站立|行走|奔跑|冲锋|厮杀|战斗|交战|对峙|跪奏|上书|奏请|吟诵|诵读|书写|挥毫|执笔|翻阅|展开|捧着|手持|身披|身穿|头戴|端坐|盘坐|俯瞰|仰望|远眺|眺望|注视|凝视|怒视|俯视|环视|巡视)/g) as string[] | null;
            if (actionPatterns) visualKeywords.push(...[...new Set(actionPatterns)].slice(0, 3));

            // Pattern 2.5: Character appearance keywords — extract subject descriptions
            // like "金色铠甲武士", "白衣少女", "身着龙袍的皇帝"
            // These help find footage where the character's appearance matches visualDesc.
            const appearancePatterns = visualDesc.match(/(?:[\u4e00-\u9fff]+铠甲|[\u4e00-\u9fff]+长袍|[\u4e00-\u9fff]+龙袍|[\u4e00-\u9fff]+冕旒|[\u4e00-\u9fff]+朝服|[\u4e00-\u9fff]+盔甲|[\u4e00-\u9fff]+僧袍|[\u4e00-\u9fff]+战甲|[\u4e00-\u9fff]+锦衣)/g) as string[] | null;
            if (appearancePatterns) visualKeywords.push(...[...new Set(appearancePatterns)].slice(0, 2));

            // Pattern 3: Proper nouns from user requirements that appear in visualDesc
            for (const pn of properNouns) {
              if (visualDesc.includes(pn)) visualKeywords.push(pn);
            }

            // Pattern 4: Show names mentioned in visualDesc with 《》
            const showInVisual = visualDesc.match(/《([^》]+)》/g) as string[] | null;
            if (showInVisual) {
              for (const show of [...new Set(showInVisual)].slice(0, 2)) {
                const showName = show.replace(/[《》]/g, "");
                // Add to visualKeywords instead of mutating effectiveSources
                if (!effectiveSources.includes(showName) && !preferredSources.includes(showName)) {
                  visualKeywords.push(showName);
                }
              }
            }

            // Pattern 5 (universal fallback): if the hardcoded word banks missed,
            // extract any 2-4 char Chinese phrases from visualDesc that look like
            // content nouns (not punctuation/function words). This catches
            // locations/objects not in the hardcoded list (莫高窟, 布达拉宫, etc.).
            if (visualKeywords.length === 0) {
              const genericKeywords = visualDesc.match(/[\u4e00-\u9fff]{2,4}/g) as string[] | null;
              if (genericKeywords) {
                // Filter out stop words and punctuation-only matches
                const stopWords = new Set([
                  "一个", "可以", "他们", "我们", "这个", "那个", "什么", "怎么",
                  "不是", "没有", "还是", "但是", "因为", "所以", "如果", "虽然",
                  "这里", "那里", "前面", "后面", "上面", "下面", "里面", "外面",
                  "之前", "之后", "已经", "正在", "一直", "非常", "比较", "更加",
                ]);
                const filtered = [...new Set(genericKeywords)]
                  .filter(k => !stopWords.has(k) && k.length === 4)
                  .slice(0, 3);
                visualKeywords.push(...filtered);
              }
            }

            // Build allVisualKeywords: merge all extracted keywords (deduplicated)
            // for later relevance scoring against candidate video titles.
            const rawKeywords = visualDesc.match(/[\u4e00-\u9fff]{2,4}/g) || [];
            const stopWordsAll = new Set([
              "一个", "可以", "他们", "我们", "这个", "那个", "什么", "怎么",
              "不是", "没有", "还是", "但是", "因为", "所以", "如果", "虽然",
              "这里", "那里", "前面", "后面", "上面", "下面", "里面", "外面",
              "之前", "之后", "已经", "正在", "一直", "非常", "比较", "更加",
              "镜头", "画面", "缓缓", "慢慢", "逐渐", "开始", "结束",
              "大全景", "特写", "近景", "远景", "俯瞰", "全景", "半身",
              "阴云", "密布", "逆光", "剪影", "光影", "色调", "氛围",
            ]);
            allVisualKeywords.push(
              ...[...new Set(rawKeywords as string[])]
                .filter((k: string) => !stopWordsAll.has(k) && k.length >= 2)
                .slice(0, 12)
            );
            // Also include materialQuery keywords for scoring
            allVisualKeywords.push(...mqKeywords);
          }

          // ── Phase 0: Required sources (user-specified, MUST appear) ──
          if (projectMaterialReqs?.requiredSources?.length) {
            for (const req of projectMaterialReqs.requiredSources.slice(0, 3)) {
              // Search: "剧名 片段" (short and effective)
              searchQueries.push({
                query: `${req} 片段`,
                label: `必须来源+片段`,
                requireTitleMatch: req,
              });
              // Search: "剧名 + top visual keyword" (if available)
              const topVkw = visualKeywords[0] || mqKeywords[0];
              if (topVkw && topVkw.length <= 6) {
                searchQueries.push({
                  query: `${req} ${topVkw}`,
                  label: `必须来源+画面词`,
                  requireTitleMatch: req,
                });
              }
            }
          }

          // ── Phase 1: AI-recommended sourceVideos (high precision) ──
          // KEY: Search show name with visualDesc core keywords FIRST,
          // then fallback to generic "剧名 片段".
          // This ensures we search for specific scenes described in visualDesc
          // rather than any random clip from the show.
          for (const sv of effectiveSources.slice(0, 3)) {
            if (projectMaterialReqs?.requiredSources?.includes(sv)) continue;
            // "剧名 + visualDesc核心画面词" — targeted search for the specific scene
            // Pick the most distinctive visual keyword (appearance > location > action)
            const appearanceKw = visualKeywords.find(kw =>
              /铠甲|长袍|龙袍|冕旒|朝服|盔甲|僧袍|战甲|锦衣/.test(kw)
            );
            const locationKw = visualKeywords.find(kw =>
              /城|殿|宫|门|堂|院|寺|营|场|港|海|江|河|山|原|漠|林/.test(kw) && kw.length >= 2 && kw.length <= 6
            );
            const actionKw = visualKeywords.find(kw =>
              /渡海|出海|航行|跪拜|叩首|跪坐|端坐|冲锋|厮杀|战斗|交战|对峙|吟诵|诵读|书写|挥毫/.test(kw)
            );
            // Priority: appearance > location > action > mqKeyword
            const sceneKw = appearanceKw || locationKw || actionKw || mqKeywords[0];
            if (sceneKw && sceneKw.length <= 6 && !sv.includes(sceneKw)) {
              searchQueries.push({
                query: `${sv} ${sceneKw}`,
                label: "剧名+核心画面词",
                requireTitleMatch: sv,
              });
            }
            // "剧名 片段" — broader fallback
            searchQueries.push({
              query: `${sv} 片段`,
              label: "剧名+片段",
              requireTitleMatch: sv,
            });
          }

          // ── Phase 1.5: Preferred sources ──
          for (const ps of preferredSources.slice(0, 2)) {
            searchQueries.push({
              query: `${ps} 片段`,
              label: "推荐来源+片段",
              requireTitleMatch: ps,
            });
          }

          // ── Phase 2: Visual keywords (NO show name — broader search) ──
          // These are the MOST IMPORTANT for matching visual description.
          // Reduced from 4 to 2 keywords × 2 queries each to cut API calls.
          const uniqueVisualKws = [...new Set(visualKeywords)].filter(
            kw => kw.length >= 2 && kw.length <= 8 && !avoidKeywords.some(ak => kw.includes(ak))
          );
          for (const vkw of uniqueVisualKws.slice(0, 2)) {
            // "关键词 纪录片" — find documentary footage (best hit rate)
            searchQueries.push({
              query: `${vkw} 纪录片`,
              label: `画面词+纪录片`,
            });
            // "关键词 电视剧" — find drama footage
            searchQueries.push({
              query: `${vkw} 电视剧`,
              label: `画面词+电视剧`,
            });
          }

          // ── Phase 2.3: AI-generated materialQuery (elevated priority) ──
          // materialQuery is the AI's distilled search term from visualDesc —
          // it should be tried BEFORE fallback voiceover keywords because
          // it's purpose-built for this exact scene's visual content.
          if (materialQuery) {
            searchQueries.push({
              query: materialQuery,
              label: "检索词",
            });
            if (mqKeywords.length > 0) {
              searchQueries.push({
                query: `${mqKeywords[0]} 电视剧`,
                label: "检索词核心+电视剧",
              });
            }
          }

          // ── Phase 2.5: properNouns from user requirements ──
          // Reduced from 2→1 noun to cut API calls (early termination usually
          // finds results before reaching this phase anyway).
          if (properNouns.length > 0) {
            const voiceText = scene.voiceoverText || "";
            const matchedNouns = properNouns.filter(pn =>
              voiceText.includes(pn) || (visualDesc || "").includes(pn)
            );
            for (const noun of matchedNouns.slice(0, 1)) {
              searchQueries.push({
                query: `${noun} 纪录片`,
                label: `专名+纪录片`,
              });
            }
          }

          // ── Phase 2.8: landmarkScenes from user requirements ──
          // Reduced from 2→1 to cut API calls.
          if (landmarkScenes.length > 0) {
            const voiceText = scene.voiceoverText || "";
            const matchedScenes = landmarkScenes.filter(ls =>
              voiceText.includes(ls) || (visualDesc || "").includes(ls)
            );
            for (const ls of matchedScenes.slice(0, 1)) {
              searchQueries.push({
                query: `${ls} 纪录片`,
                label: `标志场景+纪录片`,
              });
            }
          }

          // ── Phase 3: Fallback — voiceover text keywords ──
          {
            const voiceText = scene.voiceoverText || scene.title || "";
            // Extract concrete nouns (2-4 chars) from voiceover
            const voiceWords = voiceText.match(/[\u4e00-\u9fff]{2,4}/g) || [];
            const voiceStop = new Set([
              "然后", "为啥", "为什么", "不是", "今天", "肯定", "听过", "真实",
              "发生", "所有", "必须", "几乎", "只留", "一点", "但是", "因为",
              "所以", "如果", "虽然", "不过", "而且", "或者", "已经", "可以",
              "就是", "还是", "这个", "那个", "什么", "怎么", "这样", "那样",
              "他们", "我们", "自己", "其他", "一些", "一个", "这种", "那种",
            ]);
            const filteredVoice = voiceWords.filter((w: string) => !voiceStop.has(w)).slice(0, 3);
            if (filteredVoice.length > 0) {
              searchQueries.push({
                query: filteredVoice.join(" ") + " 纪录片",
                label: "口播词+纪录片",
              });
            }
          }

          // ── Phase 5: REMOVED — properNouns + era fallback was the lowest-
          // priority search and rarely produced useful results. The earlier
          // phases (0-3) plus the broader Bilibili fallback at the end of
          // autoSearchBilibili are sufficient. Removing this saves 1 API call
          // per scene.

          console.log(`[Render] Scene ${i} search plan (${searchQueries.length} queries):`);
          searchQueries.forEach((sq, qi) => console.log(`  Q${qi + 1} [${sq.label}]: "${sq.query}"`));

          // Search with primary query first, fallback to secondary query
          // Use the shared Bilibili search helper (lib/materials/bilibili.ts)
          // instead of an inline duplicate. It already handles retry, HTML
          // rate-limit responses, and returns typed BilibiliVideo objects.
          async function bilibiliSearch(query: string): Promise<any[]> {
            return searchBilibiliVideos(query, 10);
          }

          // Helper: check video resolution via ffprobe
          async function probeVideoResolution(path: string): Promise<{width: number, height: number} | null> {
            try {
              const { stdout } = await execFileAsync("ffprobe", [
                "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height",
                "-of", "json",
                path,
              ], { timeout: 15000 });
              const probe = JSON.parse(stdout);
              const s = probe.streams?.[0];
              if (s?.width && s?.height) {
                return { width: parseInt(s.width), height: parseInt(s.height) };
              }
            } catch {}
            return null;
          }

          // Helper: quick download head bytes to probe resolution
          async function quickDownloadHead(url: string, outPath: string, maxBytes: number): Promise<boolean> {
            try {
              const res = await fetch(url, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  "Referer": "https://www.bilibili.com/",
                  "Range": `bytes=0-${maxBytes}`,
                },
                signal: AbortSignal.timeout(15000),
              });
              if (!res.ok) return false;
              const buf = Buffer.from(await res.arrayBuffer());
              if (buf.length < 5000) return false;
              await writeFile(outPath, buf);
              return true;
            } catch { return false; }
          }

          // ── Execute search queries in priority order ──
          // Strategy: collect valid candidates, then pick the best one.
          // Title matching sourceVideos is a BONUS (preferred), not mandatory.
          // All candidates must pass the negative keyword filter.
          let candidates: { bvid: string; streamUrl: string; title: string; pic: string; durSec: number; usedQuery: string; label: string; titleMatched: boolean; relevanceScore: number; searchPhase: number }[] = [];

          for (let sqIdx = 0; sqIdx < searchQueries.length; sqIdx++) {
            const sq = searchQueries[sqIdx];
            // Stop early if we already have a good-enough candidate.
            // Lowered threshold from 0.6 to 0.4 — a titleMatched candidate
            // with score ≥0.4 is almost always good enough; continuing to
            // search just wastes time on API calls.
            if (candidates.some(c => c.titleMatched && c.relevanceScore >= 0.4)) break;
            // Stop if we have any candidate with high relevance (even without titleMatch)
            if (candidates.some(c => c.relevanceScore >= 0.6)) break;
            // Limit total candidates to avoid excessive API calls
            if (candidates.length >= 3) break;

            const results = await bilibiliSearch(sq.query);
            console.log(`[Render] Scene ${i} Q[${sq.label}] "${sq.query}" → ${results.length} results`);

            // Sort by duration descending when searching with sourceVideos
            if (sq.requireTitleMatch && results.length > 1) {
              results.sort((a: any, b: any) => {
                const parseDur = (d: string) => {
                  if (!d) return 0;
                  const p = d.split(":").map(Number);
                  return p.length === 2 ? p[0]*60+p[1] : p[0]*3600+p[1]*60+p[2];
                };
                return parseDur(b.duration) - parseDur(a.duration);
              });
            }

            // Only process top 3 results per query (speed optimization — reduced from 5)
            for (const video of results.slice(0, 3)) {
              const bvid = video.bvid;
              if (!bvid) continue;
              // Skip duplicate bvids
              if (candidates.some(c => c.bvid === bvid)) continue;

              const title = video.title?.replace(/<[^>]*>/g, "") || sq.query;

              // ── Check if title matches sourceVideos (preferred, not mandatory) ──
              let titleMatched = false;
              if (sq.requireTitleMatch) {
                const matchName = sq.requireTitleMatch;
                const titleClean = title.replace(/[\s【】\[\]「」『』《》]/g, "");
                const matchClean = matchName.replace(/[\s【】\[\]「」『』《》]/g, "");
                if (titleClean.includes(matchClean)) {
                  titleMatched = true;
                } else {
                  // Also check abbreviations (first half / last half of the show name)
                  const abbreviations = [
                    matchClean.slice(0, Math.ceil(matchClean.length / 2)),
                    matchClean.slice(-Math.ceil(matchClean.length / 2)),
                  ];
                  titleMatched = abbreviations.some(ab => ab.length >= 2 && titleClean.includes(ab));
                }
              }

              // ── Negative keyword filter (applies to ALL candidates) ──
              // Skip content that is clearly NOT official drama/documentary footage
              const negativeKeywords = [
                // 博主/二创内容
                "混剪", "踩点", "二创", "reaction", "Reaction",
                "吐槽", "影评", "观后感", "观后", "推荐", "安利",
                "UP主", "博主", "up主", "整活", "恶搞", "鬼畜",
                "弹幕", "翻唱", "cos", "Cos", "COS",
                "测评", "评测", "开箱", "拆包",
                // 短剧/言情/网剧（低质量素材）
                "短剧", "言情", "大女主", "重生", "穿越", "甜宠",
                "霸总", "逆袭", "爽剧", "微短剧", "竖屏短剧",
                // 生活/娱乐类
                "试吃", "吃播", "美食", "做饭", "探店",
                "比亚迪", "汽车", "手机", "直播", "带货",
                "搞笑", "段子", "相亲", "综艺",
                // 游戏/玩具（全面覆盖）
                "游戏", "我的世界", "Minecraft", "minecraft",
                "王者荣耀", "原神", "和平精英", "英雄联盟", "LOL",
                "绝地求生", "PUBG", "pubg", "三国杀", "率土之滨",
                "真三国无双", "全面战争", "三国志战略版",
                "三国群英传", "文明", "Red Alert", "魔兽",
                "永劫无间", "崩坏", "鸣潮", "第五人格",
                "实况", "主播", "攻略",
                "乐高", "积木", "手办", "模型",
                // 中小学课程（不适用于知识科普）
                "中小学", "初中", "高中", "小学", "课时",
                "文言文", "语文", "数学", "英语", "考试",
                "习题", "考点",
                // 动漫/二次元（非真人）
                "动漫", "动画", "番剧", "二次元", "国漫",
                // 其他不相关
                "VLOG", "vlog", "日常", "记录", "vlog",
                // User-specified avoid keywords from materialRequirements
                ...avoidKeywords,
              ];

              // For KNOWLEDGE-style projects, relax the education filter:
              // documentary titles often contain 讲解/解读/教学/知识点/解说.
              // We still block 中小学/课时/语文/数学/etc (already above) which are
              // clearly school-course material unsuitable for knowledge videos.
              if (project!.contentStyle !== "KNOWLEDGE") {
                negativeKeywords.push(
                  "解说", "讲解", "教学", "教程", "攻略",
                  "指南", "入门", "知识点", "解读",
                );
              }
              const titleLower = title.toLowerCase();
              const isNegative = negativeKeywords.some(nk => titleLower.includes(nk));
              if (isNegative) {
                console.log(`[Render] Scene ${i} candidate [${bvid}] skipped (negative keyword in "${title.slice(0, 30)}")`);
                continue;
              }

              const durParts = (video.duration || "0:00").split(":").map(Number);
              const durSec = durParts.length === 2 ? durParts[0]*60+durParts[1] : durParts[0]*3600+durParts[1]*60+durParts[2];
              // Cap at 300s (5min) even with sourceVideos to avoid pulling
              // full episodes as "material". For non-source searches the cap
              // stays at 600s (10min) to allow slightly longer documentary clips.
              const maxDuration = effectiveSources.length > 0 ? 300 : 600;
              if (durSec < 5 || durSec > maxDuration) continue;

              let streamUrl: string | null = null;
              try {
                const infoRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
                  headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/" },
                  signal: AbortSignal.timeout(5000),
                });
                if (infoRes.ok) {
                  const infoData = await infoRes.json();
                  const cid = infoData.data?.cid;
                  if (cid) {
                    const streamRes = await fetch(
                      `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=1`,
                      { headers: { "User-Agent": "Mozilla/5.0", "Referer": `https://www.bilibili.com/video/${bvid}` },
                        signal: AbortSignal.timeout(5000) }
                    );
                    if (streamRes.ok) {
                      const streamData = await streamRes.json();
                      streamUrl = streamData.data?.durl?.[0]?.url || null;
                    }
                  }
                }
              } catch { continue; }

              if (!streamUrl) continue;

              // Validate aspect ratio
              const probePath = join(workDir, `probe-${i}-${bvid}.mp4`);
              let ratio = 1.78;
              try {
                const ok = await quickDownloadHead(streamUrl, probePath, 524288);
                if (ok) {
                  const reso = await probeVideoResolution(probePath);
                  if (reso) {
                    ratio = reso.width / reso.height;
                    console.log(`[Render] Scene ${i} candidate [${bvid}] ${reso.width}x${reso.height} ratio=${ratio.toFixed(2)}`);
                  }
                }
              } catch {} finally {
                try { await unlink(probePath); } catch {}
              }

              if (ratio < 1.2) {
                console.log(`[Render] Scene ${i} candidate [${bvid}] skipped (ratio ${ratio.toFixed(2)} too narrow)`);
                continue;
              }

              const pic = video.pic?.startsWith("//") ? `https:${video.pic}` : (video.pic || "");

              // ── Compute semantic relevance score ──
              // Score = titleMatched bonus + keyword match bonus + search phase penalty
              // Range: 0.0 - 1.0
              // KEY FIX: Use "at least one keyword matches" instead of coverage ratio,
              // because Bilibili titles are typically very short (1-3 words) while
              // visualDesc has many specific keywords. Coverage ratio unfairly penalizes
              // good matches.
              const titleClean = title.replace(/[\s【】\[\]「」『』《》]/g, "");
              const uniqueAllKws = [...new Set(allVisualKeywords)];
              const matchedKwCount = uniqueAllKws.filter(kw => titleClean.includes(kw)).length;
              // Phase penalty: higher phases (broader searches) get lower base scores
              const phasePenalty = Math.min(sqIdx * 0.05, 0.2);
              // Score: titleMatch bonus (0.3) + keyword match bonus (0.1 per keyword, max 0.4) - phase penalty
              // At least 1 keyword match gives 0.1 bonus, making short titles viable
              let relScore = (titleMatched ? 0.3 : 0) + Math.min(matchedKwCount * 0.1, 0.4) - phasePenalty;
              // Bonus: if title contains materialQuery keywords (AI-curated search terms)
              // These are high-value matches since materialQuery is AI's distilled search intent
              const mqHitCount = mqKeywords.filter(kw => titleClean.includes(kw)).length;
              if (mqHitCount > 0) relScore += 0.15 * mqHitCount;
              relScore = Math.max(0.1, Math.min(relScore, 1.0));

              candidates.push({ bvid, streamUrl, title, pic, durSec, usedQuery: sq.query, label: sq.label, titleMatched, relevanceScore: Math.round(relScore * 100) / 100, searchPhase: sqIdx });
              console.log(`[Render] Scene ${i} candidate [${sq.label}] ${titleMatched ? "✅" : "⚠️"} ${title.slice(0, 40)} (${durSec}s) rel=${relScore.toFixed(2)} kw=${matchedKwCount}/${uniqueAllKws.length}`);
            }
          }

          // ── Pick the best candidate ──
          // Priority: relevanceScore (semantic) > titleMatched > longer duration
          let matchedVideo: { bvid: string; streamUrl: string; title: string; pic: string; durSec: number; usedQuery: string; relevanceScore: number } | null = null;
          if (candidates.length > 0) {
            // Sort: relevanceScore descending, then titleMatched, then duration
            candidates.sort((a, b) => {
              if (Math.abs(a.relevanceScore - b.relevanceScore) > 0.05) return b.relevanceScore - a.relevanceScore;
              if (a.titleMatched !== b.titleMatched) return a.titleMatched ? -1 : 1;
              return b.durSec - a.durSec;
            });
            const best = candidates[0];
            matchedVideo = { bvid: best.bvid, streamUrl: best.streamUrl, title: best.title, pic: best.pic, durSec: best.durSec, usedQuery: best.usedQuery, relevanceScore: best.relevanceScore };
            console.log(`[Render] Scene ${i} selected [${best.label}] ${best.titleMatched ? "✅" : "⚠️"} ${best.title.slice(0, 40)} (${best.durSec}s) rel=${best.relevanceScore.toFixed(2)} from ${candidates.length} candidates`);
          }

          // Save matched material to DB
          if (matchedVideo) {
            // ── Consistency checkpoint: verify visualDesc key entities ──
            // Check if the selected video's title/description contains any key
            // entities from visualDesc (location, character, action).
            // Low match → WARN log + lower matchScore for frontend visibility.
            const titleClean = matchedVideo.title.replace(/[\s【】\[\]「」『』《》]/g, "");
            const keyEntitiesHit = [...new Set(allVisualKeywords)].filter(kw => titleClean.includes(kw));
            const keyEntitiesTotal = [...new Set(allVisualKeywords)].length;
            const consistencyRatio = keyEntitiesTotal > 0 ? keyEntitiesHit.length / keyEntitiesTotal : 0;

            if (consistencyRatio < 0.05 && keyEntitiesTotal > 0) {
              console.warn(`[Render] Scene ${i} ⚠️ LOW CONSISTENCY: selected video "${matchedVideo.title.slice(0, 40)}" matches ${keyEntitiesHit.length}/${keyEntitiesTotal} visualDesc keywords. visualDesc: "${(visualDesc || "").slice(0, 60)}"`);
              // Downgrade matchScore to reflect low consistency
              matchedVideo.relevanceScore = Math.min(matchedVideo.relevanceScore, 0.3);
              // Accumulate warning in renderJob for frontend visibility
              const warnMsg = `场景${i + 1}素材匹配度低: "${matchedVideo.title.slice(0, 30)}" 与画面描述一致性不足`;
              try {
                const existing = renderJob.errorMessage || "";
                await prisma.renderJob.update({
                  where: { id: renderJob.id },
                  data: { errorMessage: existing ? `${existing}\n${warnMsg}` : warnMsg },
                });
              } catch {}
            } else if (consistencyRatio < 0.25 && keyEntitiesTotal > 2) {
              console.warn(`[Render] Scene ${i} ⚠️ MODERATE CONSISTENCY: ${keyEntitiesHit.length}/${keyEntitiesTotal} visualDesc keywords matched in "${matchedVideo.title.slice(0, 40)}"`);
            } else {
              console.log(`[Render] Scene ${i} consistency check: ${keyEntitiesHit.length}/${keyEntitiesTotal} visualDesc keywords matched`);
            }

            const material = await prisma.material.create({
              data: {
                projectId, name: matchedVideo.title.slice(0, 80),
                type: "VIDEO", source: "STOCK_FOOTAGE",
                fileUrl: matchedVideo.streamUrl, thumbnailUrl: matchedVideo.pic,
                width: 1920, height: 1080, duration: matchedVideo.durSec,
                externalId: `bilibili-${matchedVideo.bvid}`, externalSource: "bilibili",
                searchQuery: matchedVideo.usedQuery, matchScore: matchedVideo.relevanceScore,
              },
            });
            await prisma.scene.update({ where: { id: scene.id }, data: { materialId: material.id } });
            scene.materialId = material.id;

            // Immediately refresh the Bilibili stream URL so the stored
            // fileUrl is as fresh as possible. Bilibili stream URLs can
            // expire within minutes; refreshing here reduces the window
            // between search and the later download phase.
            try {
              const { getBilibiliVideoStream } = await import("@/lib/materials/bilibili");
              const freshUrl = await getBilibiliVideoStream(matchedVideo.bvid);
              if (freshUrl) {
                await prisma.material.update({
                  where: { id: material.id },
                  data: { fileUrl: freshUrl },
                });
              }
            } catch {
              // Non-fatal: the download path will retry with a fresh URL
            }

            return true;
          } else {
            console.warn(`[Render] Scene ${i} no matching video found after all Bilibili queries, trying Pexels fallback`);
            // ── Pexels fallback with materialQueryEn ──
            if (materialQueryEn) {
              try {
                const pexelsApiKey = process.env.PEXELS_API_KEY;
                if (pexelsApiKey) {
                  const pexelsUrl = `https://api.pexels.com/videos/search?query=${encodeURIComponent(materialQueryEn)}&per_page=5&orientation=landscape`;
                  const pexelsRes = await fetch(pexelsUrl, {
                    headers: { Authorization: pexelsApiKey },
                    signal: AbortSignal.timeout(10000),
                  });
                  if (pexelsRes.ok) {
                    const pexelsData = await pexelsRes.json();
                    const pexelsVideo = pexelsData.videos?.[0];
                    if (pexelsVideo) {
                      const bestFile = pexelsVideo.video_files?.find(
                        (f: any) => f.width >= 1280 && f.height >= 720
                      ) || pexelsVideo.video_files?.[0];
                      if (bestFile) {
                        const material = await prisma.material.create({
                          data: {
                            projectId, name: `Pexels: ${materialQueryEn}`,
                            type: "VIDEO", source: "STOCK_FOOTAGE",
                            fileUrl: bestFile.link, thumbnailUrl: pexelsVideo.image || "",
                            width: bestFile.width || 1920, height: bestFile.height || 1080,
                            duration: pexelsVideo.duration || 0,
                            externalId: `pexels-${pexelsVideo.id}`, externalSource: "pexels",
                            searchQuery: materialQueryEn, matchScore: 0.5,
                          },
                        });
                        await prisma.scene.update({ where: { id: scene.id }, data: { materialId: material.id } });
                        scene.materialId = material.id;
                        console.log(`[Render] Scene ${i} matched via Pexels: ${materialQueryEn}`);
                        return true;
                      }
                    }
                  }
                }
              } catch (err) {
                console.warn(`[Render] Scene ${i} Pexels fallback failed:`, err instanceof Error ? err.message : err);
              }
            }
          }
        } catch (err) {
          console.warn(`[Render] Scene ${i} Bilibili search failed:`, err instanceof Error ? err.message : err);
        }
        return false;
      }

      // ── Step 0: AI-generated video (Agnes Video V2.0) ──
      if (scene.sceneType === "AI_GENERATED" && !materialLoaded && !scene.materialId) {
        const agnesApiKey = process.env.AGNES_API_KEY;
        if (agnesApiKey) {
          try {
            await updateRenderProgress(renderJob.id, {
              currentStage: "materials",
              progress: 10 + (i / scenes.length) * 60, // TTS ~10%, Materials ~60%
              sceneIndex: i,
              totalScenes: scenes.length,
              sceneStage: "ai_generation",
              sceneStatus: "starting",
            });

            console.log(`[Render] Scene ${i}: AI_GENERATED — starting Agnes video generation`);

            // Timeout protection: AI generation should not exceed 8 minutes per scene
            const AI_GEN_TIMEOUT_MS = 8 * 60 * 1000;

            // Start heartbeat to keep progress alive during long AI generation
            const heartbeatInterval = setInterval(() => {
              updateRenderProgress(renderJob.id, {
                sceneStatus: "generating...",
                estimatedRemaining: Math.max(0, (estimatedRemaining || 300) - 10),
              }).catch(() => {});
            }, 30000); // Every 30s — enough for progress UX, low DB pressure

            let estimatedRemaining = 300; // Start with 5 min estimate

            let genResult: Awaited<ReturnType<typeof import("@/lib/video-gen").generateVideoFromScene>> = null;
            try {
              genResult = await Promise.race([
                generateVideoFromScene(
                  {
                    visualDesc,
                    voiceoverText: scene.voiceoverText,
                    materialQuery,
                    materialQueryEn,
                    sceneNumber: scene.sceneNumber,
                  },
                  workDir,
                  { width: config.width || 1920, height: config.height || 1080, fps: config.fps || 24 },
                  (status) => {
                    console.log("[Render] Scene " + i + " AI generation: " + status);
                    // Update progress on each status change
                    updateRenderProgress(renderJob.id, {
                      sceneStatus: status,
                      estimatedRemaining: 300, // ~5 min estimate for AI gen
                    }).catch(() => {});
                  }
                ),
                new Promise<null>((_, reject) =>
                  setTimeout(() => reject(new Error("AI generation timeout (8min)")), AI_GEN_TIMEOUT_MS)
                )
              ]);
            } finally {
              // Always clear heartbeat — even on timeout reject
              clearInterval(heartbeatInterval);
            }

            if (genResult && genResult.filePath) {
              // Scale AI-generated video to target resolution (no watermark removal needed)
              const targetW = config.width || 1920;
              const targetH = config.height || 1080;
              const scaleFilter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black`;

              try {
                await execFileAsync("ffmpeg", [
                  "-y", "-i", genResult.filePath,
                  "-vf", scaleFilter,
                  "-c:v", "libx264", "-pix_fmt", "yuv420p",
                  "-an", materialFile,
                ], { timeout: 30000 });
                materialLoaded = true;
                console.log(`[Render] Scene ${i}: AI-generated video ready (${genResult.duration}s)`);
              } catch (scaleErr) {
                console.warn(`[Render] Scene ${i}: AI-generated video scale failed:`, scaleErr instanceof Error ? scaleErr.message : scaleErr);
              }
            }
          } catch (err) {
            // AI generation failed — in ai_video mode we fall back to MG or dark bg,
            // NEVER to B站 stock footage (to keep AI and stock modes fully separated).
            console.warn(`[Render] Scene ${i}: AI generation failed, falling back to MG/dark-bg:`, err instanceof Error ? err.message : err);
          }
        } else {
          console.warn(`[Render] Scene ${i}: AI_GENERATED but AGNES_API_KEY not set — will use MG/dark-bg fallback (no B站)`);

        }
      }

      // Step 1: Auto-search if no material loaded and no material attached.
      // AI_GENERATED scenes in ai_video mode: skip B站/Pexels entirely —
      // these scenes use AI-only generation to stay visually consistent.
      if (!scene.materialId && !materialLoaded) {
        if (scene.sceneType !== "AI_GENERATED" || !isAiVideoMode) {
          await autoSearchBilibili();
        } else {
          console.log(`[Render] Scene ${i} AI_GENERATED — skipping external material search`);
        }
      }

      // Step 2: Download existing material (from confirm route or auto-search).
      // AI_GENERATED scenes: skip external material download — use AI generation only.
      if (scene.materialId && scene.sceneType !== "AI_GENERATED") {
        const material = await prisma.material.findUnique({
          where: { id: scene.materialId },
        });
        if (material) {
          const ext = material.type === "VIDEO" ? "mp4" : "jpg";
          const localPath = join(workDir, `src-${i}.${ext}`);

          // Try download with retry (Pexels CDN can be flaky)
          for (let attempt = 0; attempt < 3 && !materialLoaded; attempt++) {
            try {
              if (attempt > 0) {
                console.log(`[Render] Scene ${i} material download retry ${attempt}`);
                await new Promise(r => setTimeout(r, 500 * attempt));
              }

              const isBilibili = material.externalSource === "bilibili";
              const dlHeaders: Record<string, string> = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              };
              if (isBilibili) {
                dlHeaders["Referer"] = "https://www.bilibili.com/";
                dlHeaders["Origin"] = "https://www.bilibili.com";
              }

              let fileUrl = material.fileUrl;

              // Bilibili stream URLs expire quickly — refresh only on retry
              // (attempt > 0). The search phase already refreshed the URL when
              // the material was first found, so the initial download attempt
              // uses the freshest URL. Only re-refresh if the first attempt
              // fails (likely due to URL expiry during the search→download gap).
              if (isBilibili && attempt > 0) {
                const bvidMatch = material.externalId?.match(/bilibili-(.+)/);
                const bvid = bvidMatch?.[1];
                if (bvid) {
                  try {
                    const { getBilibiliVideoStream } = await import("@/lib/materials/bilibili");
                    const freshUrl = await getBilibiliVideoStream(bvid);
                    if (freshUrl) {
                      fileUrl = freshUrl;
                      await prisma.material.update({
                        where: { id: material.id },
                        data: { fileUrl: freshUrl },
                      });
                      console.log(`[Render] Scene ${i} refreshed Bilibili stream URL (retry ${attempt})`);
                    }
                  } catch (refreshErr) {
                    console.warn(`[Render] Scene ${i} failed to refresh stream URL:`, refreshErr instanceof Error ? refreshErr.message : refreshErr);
                  }
                }
              }

              const res = await fetch(fileUrl, {
                signal: AbortSignal.timeout(60000),
                headers: dlHeaders,
              });

              if (!res.ok) {
                console.warn(`[Render] Scene ${i} material HTTP ${res.status} from ${fileUrl.substring(0, 80)}`);
                continue;
              }

              const buffer = Buffer.from(await res.arrayBuffer());
              if (buffer.length < 1000) {
                console.warn(`[Render] Scene ${i} material too small (${buffer.length} bytes)`);
                continue;
              }

              await writeFile(localPath, buffer);
              console.log(`[Render] Scene ${i} material downloaded: ${(buffer.length / 1024).toFixed(0)}KB`);

              // Build combined filter chain: watermark removal + scale in one pass
              // This avoids a separate FFmpeg call for watermark removal (major speedup)
              const targetW = config.width || 1920;
              const targetH = config.height || 1080;
              const scaleFilter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black`;

              const needsWatermarkRemoval =
                (material.source !== "STOCK_FOOTAGE" && material.source !== "AI_GENERATED") ||
                material.externalSource === "bilibili" ||
                material.externalSource === "douyin";

              let combinedFilter = scaleFilter;
              let processedPath = localPath;

              if (needsWatermarkRemoval) {
                try {
                  const dims = await probeDimensions(localPath);
                  if (dims.width > 0 && dims.height > 0) {
                    const isBilibili = material.externalSource === "bilibili";
                    const regions = isBilibili
                      ? getBilibiliWatermarkRegions(dims.width, dims.height)
                      : detectWatermarkRegions(dims.width, dims.height);

                    const delogoFilters = regions.map(
                      (r) => `delogo=x=${r.x}:y=${r.y}:w=${r.width}:h=${r.height}:show=0`
                    );
                    const cropFilter = `crop=iw*0.90:ih*0.90:iw*0.05:ih*0.05,hqdn3d=2:2:3:3`;
                    // Combine: delogo → crop → scale (all in one pass)
                    combinedFilter = [...delogoFilters, cropFilter, scaleFilter].join(",");
                    console.log(`[Render] Scene ${i} combined filter: delogo+crop+scale (${dims.width}x${dims.height}, ${regions.length} regions)`);
                  }
                } catch {
                  // Fallback: crop + scale combined
                  combinedFilter = `crop=iw*0.88:ih*0.88:iw*0.06:ih*0.06,${scaleFilter}`;
                  console.log(`[Render] Scene ${i} fallback combined filter: crop+scale`);
                }
              }

              if (ext === "jpg") {
                const imgDuration = Math.max(8, Math.ceil(estimateAudioDuration(scene.voiceoverText) * 1.3));
                await execFileAsync("ffmpeg", [
                  "-y", "-loop", "1", "-i", processedPath,
                  "-c:v", "libx264", "-t", String(imgDuration), "-pix_fmt", "yuv420p",
                  "-vf", combinedFilter,
                  "-an", materialFile,
                ], { timeout: 30000 });
              } else {
                // Get video duration
                let videoDuration = 0;
                try {
                  const { stdout } = await execFileAsync("ffprobe", [
                    "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    processedPath,
                  ], { timeout: 10000 });
                  videoDuration = parseFloat(stdout.trim()) || 0;
                } catch {}

                let trimArgs: string[] = [];
                const neededDuration = Math.ceil(estimateAudioDuration(scene.voiceoverText) * 1.3);
                const needsLoop = videoDuration > 0 && videoDuration < neededDuration;
                if (videoDuration > 10 && !needsLoop) {
                  const clipLength = Math.min(Math.max(videoDuration * 0.15, neededDuration), videoDuration - 2);
                  let startSec: number;
                  if (videoDuration > 300) {
                    const rangeStart = videoDuration * 0.25;
                    const rangeEnd = videoDuration * 0.75 - clipLength;
                    startSec = Math.max(rangeStart, Math.min(videoDuration * 0.4, rangeEnd));
                  } else if (videoDuration > 60) {
                    startSec = Math.max(videoDuration * 0.15, Math.min(videoDuration * 0.4, videoDuration - clipLength - 2));
                  } else {
                    startSec = Math.max(1, videoDuration * 0.1);
                  }
                  const startTime = startSec.toFixed(2);
                  trimArgs = ["-ss", startTime, "-t", String(Math.round(clipLength))];
                  console.log(`[Render] Scene ${i} trimming ${clipLength.toFixed(1)}s from ${startTime}s (total ${videoDuration.toFixed(1)}s, need ${neededDuration}s)`);
                } else if (videoDuration > 0) {
                  console.log(`[Render] Scene ${i} video short (${videoDuration.toFixed(1)}s, need ${neededDuration}s), ${needsLoop ? "looping" : "using full clip"}`);
                }

                const loopArgs = needsLoop ? ["-stream_loop", "-1"] : [];
                const durationCap = needsLoop ? ["-t", String(neededDuration)] : [];

                // Single FFmpeg call: watermark removal + scale + trim all combined
                await execFileAsync("ffmpeg", [
                  "-y", ...loopArgs, ...trimArgs, "-i", processedPath,
                  "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
                  "-vf", combinedFilter,
                  ...durationCap,
                  "-an", "-pix_fmt", "yuv420p", materialFile,
                ], { timeout: 60000 });
              }
              materialLoaded = true;
              console.log(`[Render] Scene ${i} material processed OK`);
            } catch (err) {
              console.error(`[Render] Scene ${i} material attempt ${attempt} failed:`, err instanceof Error ? err.message : err);
            }
          }
        } else {
          console.warn(`[Render] Scene ${i} material record not found: ${scene.materialId}, re-searching`);
          // Clear the stale materialId and re-search
          await prisma.scene.update({ where: { id: scene.id }, data: { materialId: null } });
          scene.materialId = null;
          await autoSearchBilibili();
        }
      } else {
        console.warn(`[Render] Scene ${i} has no materialId`);
      }

      if (!materialLoaded) {
        const voiceText = scene.voiceoverText || "";
        const shouldUseMG = isMGAnimationScene(scene.sceneType, voiceText);

        if (shouldUseMG) {
          // ── MG animation: only for data/statistics/comparison scenes ──
          console.warn(`[Render] Scene ${i} suitable for MG animation, generating data visualization`);
          const w = config.width;
          const h = config.height;
          const fontPath = getDefaultFontPath();

          const dataPoints = extractDataPoints(voiceText);
          const tableData = extractTableData(voiceText);
          const drawTextFilters = tableData
            ? buildMGTableDrawText(tableData, w, h, fontPath)
            : buildMGDataDrawText(dataPoints, w, h, fontPath);

          const mgDuration = 30;
          if (drawTextFilters) {
            await execFileAsync("ffmpeg", [
              "-y",
              "-f", "lavfi", "-i", `color=c=0x1a1a2e:s=${w}x${h}:d=${mgDuration}:r=${config.fps}`,
              "-vf", drawTextFilters,
              "-c:v", "libx264", "-preset", "ultrafast", "-t", String(mgDuration), "-pix_fmt", "yuv420p",
              "-an", materialFile,
            ], { timeout: 60000 });
          } else {
            await execFileAsync("ffmpeg", [
              "-y",
              "-f", "lavfi", "-i", `color=c=0x1a1a2e:s=${w}x${h}:d=${mgDuration}:r=${config.fps}`,
              "-c:v", "libx264", "-preset", "ultrafast", "-t", String(mgDuration), "-pix_fmt", "yuv420p",
              "-an", materialFile,
            ], { timeout: 60000 });
          }
        } else if (isAiVideoMode && scene.sceneType === "AI_GENERATED") {
          // ── AI mode: NO external fallback. AI_GENERATED scenes that fail
          // AI gen get a dark background — never B站/Pexels.
          console.warn(`[Render] Scene ${i} AI_GENERATED fallback — using dark background`);
          await execFileAsync("ffmpeg", [
            "-y",
            "-f", "lavfi", "-i", `color=c=0x1a1a2e:s=${config.width}x${config.height}:d=30:r=${config.fps}`,
            "-c:v", "libx264", "-preset", "ultrafast", "-t", "30", "-pix_fmt", "yuv420p",
            "-an", materialFile,
          ], { timeout: 30000 });
        } else {
          // ── Non-MG scene: try broader search, then Pexels image + Ken Burns ──
          console.warn(`[Render] Scene ${i} not suitable for MG, trying broader search fallback`);

          // Try broader Bilibili search with generic terms
          let broaderFound = false;
          const broaderQueries = [
            // Try with era + "纪录片" (most generic but reliable)
            ...(meta?.era ? [`${meta.era.match(/[\u4e00-\u9fff]{2,4}/g)?.[0] || ""} 纪录片`] : []),
            // Try with materialQuery + "空镜"
            ...(materialQuery ? [`${materialQuery.split(/[\s,，、]/)[0]} 空镜`] : []),
            // Generic historical documentary
            "中国历史 纪录片",
          ].filter(q => q && q.length >= 4);

          for (const bq of broaderQueries.slice(0, 2)) {
            if (broaderFound) break;
            try {
              const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(bq)}&page=1&page_size=5&order=totalrank`;
              const res = await fetch(url, {
                headers: {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  "Referer": "https://www.bilibili.com/",
                },
                signal: AbortSignal.timeout(10000),
              });
              if (!res.ok) continue;
              const data = await res.json();
              const results = (data.data?.result || []).slice(0, 5);
              for (const video of results) {
                const bvid = video.bvid;
                if (!bvid) continue;
                const title = (video.title || "").replace(/<[^>]*>/g, "");
                // Basic negative filter
                if (["解说", "混剪", "教程", "游戏", "动漫", "短剧", "搞笑"].some(nk => title.includes(nk))) continue;
                const durParts = (video.duration || "0:00").split(":").map(Number);
                const durSec = durParts.length === 2 ? durParts[0]*60+durParts[1] : durParts[0]*3600+durParts[1]*60+durParts[2];
                if (durSec < 30 || durSec > 3600) continue;

                // Get stream URL
                let streamUrl: string | null = null;
                try {
                  const infoRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
                    headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/" },
                    signal: AbortSignal.timeout(5000),
                  });
                  if (infoRes.ok) {
                    const infoData = await infoRes.json();
                    const cid = infoData.data?.cid;
                    if (cid) {
                      const streamRes = await fetch(
                        `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=1`,
                        { headers: { "User-Agent": "Mozilla/5.0", "Referer": `https://www.bilibili.com/video/${bvid}` },
                          signal: AbortSignal.timeout(5000) }
                      );
                      if (streamRes.ok) {
                        const streamData = await streamRes.json();
                        streamUrl = streamData.data?.durl?.[0]?.url || null;
                      }
                    }
                  }
                } catch { continue; }
                if (!streamUrl) continue;

                // Download and process
                const srcPath = join(workDir, `src-${i}-fallback.mp4`);
                const dlHeaders: Record<string, string> = {
                  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                  "Referer": "https://www.bilibili.com/",
                  "Origin": "https://www.bilibili.com",
                };
                const dlRes = await fetch(streamUrl, { headers: dlHeaders, signal: AbortSignal.timeout(60000) });
                if (!dlRes.ok) continue;
                await writeFile(srcPath, Buffer.from(await dlRes.arrayBuffer()));

                // Process: scale + pad + trim
                const { stdout: probeOut } = await execFileAsync("ffprobe", [
                  "-v", "error", "-show_entries", "format=duration",
                  "-of", "default=noprint_wrappers=1:nokey=1", srcPath,
                ], { timeout: 10000 });
                const videoDuration = parseFloat(probeOut.trim()) || 30;

                await execFileAsync("ffmpeg", [
                  "-y", "-i", srcPath,
                  "-vf", `scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
                  "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
                  "-t", "30", "-an", "-pix_fmt", "yuv420p", materialFile,
                ], { timeout: 60000 });

                materialLoaded = true;
                broaderFound = true;
                console.log(`[Render] Scene ${i} broader search found: ${title.slice(0, 40)}`);
                break;
              }
            } catch { continue; }
          }

          // If broader search also failed, try Pexels image + Ken Burns
          if (!materialLoaded) {
            console.warn(`[Render] Scene ${i} broader search also failed, trying Pexels image fallback`);
            try {
              const pexelsApiKey = process.env.PEXELS_API_KEY;
              if (pexelsApiKey && materialQueryEn) {
                const pexelsUrl = `https://api.pexels.com/v1/search?query=${encodeURIComponent(materialQueryEn)}&per_page=3&orientation=landscape`;
                const pexelsRes = await fetch(pexelsUrl, {
                  headers: { Authorization: pexelsApiKey },
                  signal: AbortSignal.timeout(10000),
                });
                if (pexelsRes.ok) {
                  const pexelsData = await pexelsRes.json();
                  const photo = pexelsData.photos?.[0];
                  if (photo?.src?.large) {
                    // Download image
                    const imgPath = join(workDir, `pexels-${i}.jpg`);
                    const imgRes = await fetch(photo.src.large, { signal: AbortSignal.timeout(30000) });
                    if (imgRes.ok) {
                      await writeFile(imgPath, Buffer.from(await imgRes.arrayBuffer()));
                      // Ken Burns effect: slow zoom on image
                      await execFileAsync("ffmpeg", [
                        "-y", "-loop", "1", "-i", imgPath,
                        "-vf", `scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,zoompan=z='min(zoom+0.0008,1.2)':d=750:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${config.width}x${config.height}`,
                        "-c:v", "libx264", "-preset", "ultrafast", "-t", "30", "-pix_fmt", "yuv420p",
                        "-an", materialFile,
                      ], { timeout: 60000 });
                      materialLoaded = true;
                      console.log(`[Render] Scene ${i} using Pexels image with Ken Burns effect`);
                    }
                  }
                }
              }
            } catch (err) {
              console.warn(`[Render] Scene ${i} Pexels image fallback failed:`, err instanceof Error ? err.message : err);
            }
          }

          // Last resort: simple dark background (no fake MG data)
          if (!materialLoaded) {
            console.warn(`[Render] Scene ${i} all fallbacks failed, using plain dark background`);
            const w = config.width;
            const h = config.height;
            await execFileAsync("ffmpeg", [
              "-y",
              "-f", "lavfi", "-i", `color=c=0x1a1a2e:s=${w}x${h}:d=30:r=${config.fps}`,
              "-c:v", "libx264", "-preset", "ultrafast", "-t", "30", "-pix_fmt", "yuv420p",
              "-an", materialFile,
            ], { timeout: 30000 });
          }
        }
      }
    });

    // Compose stage
    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: { status: "COMPOSITING", currentStage: "compose" },
    });

    const outputName = `${randomUUID()}.mp4`;
    const outputDir = join(process.cwd(), "uploads", projectId, "output");
    await mkdir(outputDir, { recursive: true });
    const outputPath = join(outputDir, outputName);

    let totalDuration = 0; // accumulated actual audio durations

    // ── Step 1: Compose each scene individually (avoids ENAMETOOLONG) ──
    // Parallel compose: each scene is independent (different input/output files),
    // so we can compose multiple scenes concurrently. Limit to 2 concurrent
    // FFmpeg processes to avoid overwhelming CPU on typical 4-8 core machines.
    // AI mode: most time is in network I/O, FFmpeg compose is the fast final pass.
    // Raise to 4 to keep CPU busy while scenes are coming off the AI pipeline.
    const COMPOSE_CONCURRENCY = isAiVideoMode ? 4 : 2;
    const sceneDurations: number[] = new Array(scenes.length).fill(0);
    const composedFiles: string[] = new Array(scenes.length).fill("");

    await mapConcurrent(scenes, COMPOSE_CONCURRENCY, async (scene, i) => {
      const materialFile = join(workDir, `scene-${i}.mp4`);
      const audioFile = join(workDir, `tts-${i}.mp3`);
      const composedFile = join(workDir, `composed-${i}.mp4`);

      // Ensure material exists
      let hasMaterial = true;
      try { await readFile(materialFile); } catch { hasMaterial = false; }
      if (!hasMaterial) {
        const w = config.width;
        const h = config.height;
        const voiceText = scene.voiceoverText || "";
        const shouldUseMG = isMGAnimationScene(scene.sceneType, voiceText);

        if (shouldUseMG) {
          const fontPath = getDefaultFontPath();
          const dataPoints = extractDataPoints(voiceText);
          const drawTextFilters = buildMGDataDrawText(dataPoints, w, h, fontPath);

          const mgDuration = 30;
          if (drawTextFilters) {
            await execFileAsync("ffmpeg", [
              "-y",
              "-f", "lavfi", "-i", `color=c=0x1a1a2e:s=${w}x${h}:d=${mgDuration}:r=${config.fps}`,
              "-vf", drawTextFilters,
              "-c:v", "libx264", "-preset", "ultrafast", "-t", String(mgDuration), "-pix_fmt", "yuv420p",
              "-an", materialFile,
            ], { timeout: 60000 });
          } else {
            await execFileAsync("ffmpeg", [
              "-y",
              "-f", "lavfi", "-i", `color=c=0x1a1a2e:s=${w}x${h}:d=${mgDuration}:r=${config.fps}`,
              "-c:v", "libx264", "-preset", "ultrafast", "-t", String(mgDuration), "-pix_fmt", "yuv420p",
              "-an", materialFile,
            ], { timeout: 60000 });
          }
        } else {
          // Non-MG scene: just use plain dark background
          await execFileAsync("ffmpeg", [
            "-y",
            "-f", "lavfi", "-i", `color=c=0x1a1a2e:s=${w}x${h}:d=30:r=${config.fps}`,
            "-c:v", "libx264", "-preset", "ultrafast", "-t", "30", "-pix_fmt", "yuv420p",
            "-an", materialFile,
          ], { timeout: 30000 });
        }
      }

      // Ensure audio exists
      let hasAudio = true;
      try { await readFile(audioFile); } catch { hasAudio = false; }
      if (!hasAudio) {
        console.warn(`[Render] Compose: audio missing for scene ${i}, generating fallback`);
        const estimatedDur = estimateAudioDuration(scene.voiceoverText);
        try {
          await execFileAsync("ffmpeg", [
            "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-t", String(estimatedDur), "-c:a", "libmp3lame", "-b:a", "128k", audioFile,
          ], { timeout: 10000 });
        } catch {
          const sampleRate = 44100;
          const numSamples = Math.ceil(estimatedDur * sampleRate);
          const dataSize = numSamples * 2 * 2;
          const wav = Buffer.alloc(44 + dataSize);
          wav.write("RIFF", 0);
          wav.writeUInt32LE(36 + dataSize, 4);
          wav.write("WAVE", 8);
          wav.write("fmt ", 12);
          wav.writeUInt32LE(16, 16);
          wav.writeUInt16LE(1, 20);
          wav.writeUInt16LE(2, 22);
          wav.writeUInt32LE(44100, 24);
          wav.writeUInt32LE(176400, 28);
          wav.writeUInt16LE(4, 32);
          wav.writeUInt16LE(16, 34);
          wav.write("data", 36);
          wav.writeUInt32LE(dataSize, 40);
          await writeFile(audioFile, wav).catch(() => {});
        }
      }

      // Get audio duration
      let audioDuration = ttsDurationMap.get(i) || 0;
      if (audioDuration <= 0) {
        const probedDuration = await getAudioDuration(audioFile);
        audioDuration = probedDuration > 0 ? probedDuration : estimateAudioDuration(scene.voiceoverText);
      }
      audioDuration = Math.max(audioDuration, 0.5);

      console.log(`[Render] Compose scene ${i}: audioDuration=${audioDuration.toFixed(2)}s (source: ${ttsDurationMap.get(i) ? "tts-stage" : "fallback"})`);

      // Generate subtitles
      let scripts: string[] | undefined;
      if (scene.productionMeta) {
        try {
          const meta = JSON.parse(scene.productionMeta as string);
          if (meta.scripts?.length) scripts = meta.scripts;
        } catch {}
      }

      const subtitleConfig: SubtitleConfig = {
        videoWidth: config.width,
        videoHeight: config.height,
        audioDuration,
      };
      const subtitleChunks = generateSubtitleChunks(
        scene.voiceoverText,
        subtitleConfig,
        scripts
      );

      const audioDurStr = audioDuration.toFixed(3);

      // Probe material duration to decide filter approach.
      // If the material is shorter than the audio, use Ken Burns zoom
      // to smoothly fill the extra time. If it's already long enough,
      // skip zoompan — it only wastes CPU and can cause timing drift
      // when fps differs between the material (often 25fps from B站)
      // and config.fps (30fps).
      let materialDuration = 0;
      try {
        const { stdout } = await execFileAsync("ffprobe", [
          "-v", "error", "-show_entries", "format=duration",
          "-of", "default=noprint_wrappers=1:nokey=1", materialFile,
        ], { timeout: 5000 });
        materialDuration = parseFloat(stdout.trim()) || 0;
      } catch {}

      const needsExtension = materialDuration > 0 && materialDuration < audioDuration * 0.85;
      const totalFrames = Math.ceil(audioDuration * config.fps);

      // Build filter chain for this scene
      const sceneFilters: string[] = [];
      if (needsExtension) {
        // Material is too short → Ken Burns slow zoom to fill audio
        const kenBurnsFilter = `zoompan=z='min(zoom+0.0005,1.05)':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${config.width}x${config.height}:fps=${config.fps}`;
        sceneFilters.push(
          `[0:v]scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,${kenBurnsFilter},fade=in:st=0:d=0.3,trim=duration=${audioDurStr},setpts=PTS-STARTPTS[v0]`
        );
        console.log(`[Render] Compose scene ${i}: Ken Burns (material ${materialDuration.toFixed(1)}s < audio ${audioDuration.toFixed(1)}s)`);
      } else {
        // Material long enough → simple scale+trim, no effects needed
        sceneFilters.push(
          `[0:v]scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,trim=duration=${audioDurStr},setpts=PTS-STARTPTS[v0]`
        );
      }

      // Build subtitle filter chain
      const { filterParts: subFilters, outputLabel: subLabel } = buildSubtitleFilterChain(
        "v0",
        subtitleChunks,
        subtitleConfig
      );
      sceneFilters.push(...subFilters);

      // Audio filter
      sceneFilters.push(
        `[1:a]volume=2.0,aresample=44100,atrim=0:${audioDurStr},asetpts=PTS-STARTPTS[a0]`
      );

      // Compose this scene: video with subtitles + audio
      await execFileAsync("ffmpeg", [
        "-y",
        "-i", materialFile,
        "-i", audioFile,
        "-filter_complex", sceneFilters.join(";"),
        "-map", `[${subLabel}]`, "-map", "[a0]",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
        "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
        "-r", String(config.fps),
        "-pix_fmt", "yuv420p",
        composedFile,
      ], { timeout: 120000 });

      composedFiles[i] = composedFile;

      // Update scene duration
      await prisma.scene.update({
        where: { id: scene.id },
        data: { audioDuration },
      });

      sceneDurations[i] = audioDuration;
    });

    // Calculate total duration after all parallel compose tasks complete
    totalDuration = sceneDurations.reduce((sum, d) => sum + d, 0);

    // Filter out any empty entries (failed compose)
    const validComposedFiles = composedFiles.filter(f => f !== "");

    // ── Step 2: Concatenate all composed scenes using concat demuxer ──
    if (validComposedFiles.length === 0) throw new Error("No scenes to compose");

    const concatListPath = join(workDir, "concat.txt");
    const concatContent = validComposedFiles.map(f => `file '${f.replace(/'/g, "'\\''")}'`).join("\n");
    await writeFile(concatListPath, concatContent);

    // Check for background music
    let finalOutputPath = outputPath;
    if (project.musicTracks.length > 0 && project.musicTracks[0].fileUrl) {
      const music = project.musicTracks[0];
      const musicFile = join(workDir, "bgm.mp3");
      const preMixPath = join(workDir, "premix.mp4");
      try {
        const res = await fetch(music.fileUrl);
        if (res.ok && res.body) {
          // Stream bgm to disk to avoid keeping the full file in memory
          await pipeline(Readable.fromWeb(res.body as any), createWriteStream(musicFile));

          // Concat scenes first
          await execFileAsync("ffmpeg", [
            "-y", "-f", "concat", "-safe", "0", "-i", concatListPath,
            "-c", "copy", preMixPath,
          ], { timeout: 300000 });

          // Mix with background music
          await execFileAsync("ffmpeg", [
            "-y",
            "-i", preMixPath,
            "-i", musicFile,
            "-filter_complex",
            `[1:a]volume=${music.volume},afade=t=in:st=0:d=${music.fadeIn},afade=t=out:st=${totalDuration - music.fadeOut}:d=${music.fadeOut}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[finala]`,
            "-map", "0:v", "-map", "[finala]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
            "-movflags", "+faststart",
            outputPath,
          ], { timeout: 300000 });

          finalOutputPath = outputPath;
        } else {
          // No music - just concat
          await execFileAsync("ffmpeg", [
            "-y", "-f", "concat", "-safe", "0", "-i", concatListPath,
            "-c", "copy", "-movflags", "+faststart",
            outputPath,
          ], { timeout: 300000 });
        }
      } catch (bgmErr) {
        // Music mixing failed - just concat without music, but warn the user
        const bgmWarning = `BGM混音失败，已生成无背景音乐版本: ${bgmErr instanceof Error ? bgmErr.message.slice(0, 200) : "unknown error"}`;
        console.warn(`[Render] ${bgmWarning}`);
        try {
          const existingWarnings = renderJob.errorMessage || "";
          await prisma.renderJob.update({
            where: { id: renderJob.id },
            data: { errorMessage: existingWarnings ? `${existingWarnings}\n${bgmWarning}` : bgmWarning },
          });
        } catch {}
        await execFileAsync("ffmpeg", [
          "-y", "-f", "concat", "-safe", "0", "-i", concatListPath,
          "-c", "copy", "-movflags", "+faststart",
          outputPath,
        ], { timeout: 300000 });
      }
    } else {
      // No music - simple concat
      await execFileAsync("ffmpeg", [
        "-y", "-f", "concat", "-safe", "0", "-i", concatListPath,
        "-c", "copy", "-movflags", "+faststart",
        outputPath,
      ], { timeout: 300000 });
    }

    // Get duration
    let duration = 0;
    try {
      const { stdout } = await execFileAsync("ffprobe", [
        "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", outputPath,
      ], { timeout: 10000 });
      duration = parseFloat(stdout.trim());
    } catch {}

    const outputUrl = `/api/uploads/${projectId}/output/${outputName}`;

    // Get output file size without loading the entire video into memory
    let outputSize = 0;
    try {
      const outputStat = await import("fs/promises").then(m => m.stat(outputPath));
      outputSize = outputStat.size;
    } catch {}

    // ── Material coverage verification ──
    // Check if requiredSources from materialRequirements were actually used
    if (project.materialRequirements) {
      try {
        const reqs = JSON.parse(project.materialRequirements);
        const requiredSources: string[] = reqs.requiredSources || [];
        if (requiredSources.length > 0) {
          // Get all materials used in this render
          const usedMaterials = await prisma.material.findMany({
            where: { projectId, source: "STOCK_FOOTAGE" },
            select: { name: true, searchQuery: true },
          });
          const usedNames = usedMaterials.map(m => `${m.name} ${m.searchQuery}`).join(" ");
          const covered = requiredSources.filter(rs => usedNames.includes(rs));
          const uncovered = requiredSources.filter(rs => !usedNames.includes(rs));
          if (uncovered.length > 0) {
            console.warn(`[Render] Material coverage warning: required sources NOT found: ${uncovered.join(", ")}`);
            console.log(`[Render] Covered sources: ${covered.join(", ") || "none"}`);
          } else {
            console.log(`[Render] Material coverage OK: all required sources found (${covered.join(", ")})`);
          }
        }
      } catch {}
    }

    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: {
        status: "COMPLETED",
        outputUrl,
        outputFormat: config.format,
        outputSize,
        outputDuration: duration,
        completedAt: new Date(),
        progress: 100,
      },
    });

    // Use state machine for validated transition
    const completedTransition = await transitionProject(projectId, userId, "COMPLETED");
    if (!completedTransition.success) {
      console.warn(`[Render] State transition to COMPLETED failed:`, completedTransition.error);
    }

    await rm(workDir, { recursive: true, force: true }).catch(() => {});

    return { outputUrl, duration };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Render] Pipeline error:", message);
    // renderJob may not exist if error occurred before its creation
    if (typeof renderJob !== "undefined" && renderJob?.id) {
      await prisma.renderJob.update({
        where: { id: renderJob.id },
        data: { status: "FAILED", errorMessage: message },
      }).catch(() => {});
    }
    // Validate the FAILED transition via state machine
    await transitionProject(projectId, userId, "FAILED").catch(() => {});
    // Clean up temporary files even on failure to prevent disk exhaustion
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
