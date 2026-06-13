import { prisma } from "@/lib/db";
import { execFile, exec } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, unlink, mkdir, rm } from "fs/promises";
import { join } from "path";
import { probeDimensions, detectWatermarkRegions } from "@/lib/materials/watermark";
import { randomUUID } from "crypto";
import { tmpdir } from "os";
import {
  generateSubtitleChunks,
  buildSubtitleFilterChain,
  estimateAudioDuration,
  type SubtitleConfig,
} from "./subtitle";
import { mapConcurrent } from "@/lib/utils/concurrent";
import { withRetry, isFFmpegRetryableError, isNetworkError } from "@/lib/utils/retry";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

/** Try multiple Python paths for edge_tts, using shell for PATH resolution */
async function generateTTS(text: string, voice: string, outputFile: string): Promise<boolean> {
  const pythonPaths = ["python", "python3"];
  for (const py of pythonPaths) {
    try {
      await execAsync(
        `${py} -m edge_tts --voice "${voice}" --rate "+0%" --text "${text.replace(/"/g, '\\"')}" --write-media "${outputFile}"`,
        { timeout: 60000, maxBuffer: 1024 * 1024 }
      );
      // Verify file was created and has content
      try {
        const stat = await import("fs/promises").then(m => m.stat(outputFile));
        if (stat.size > 100) return true;
      } catch {}
    } catch {
      continue;
    }
  }
  // Fallback: try with spawn + shell as last resort
  try {
    await execAsync(
      `python -m edge_tts --voice "${voice}" --rate "+0%" --text "${text.replace(/"/g, '\\"')}" --write-media "${outputFile}"`,
      { timeout: 60000, shell: "powershell.exe", maxBuffer: 1024 * 1024 }
    );
    try { const stat = await import("fs/promises").then(m => m.stat(outputFile)); if (stat.size > 100) return true; } catch {}
  } catch {}
  return false;
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

  try {
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "RENDERING" },
    });

    const workDir = join(tmpdir(), `render-${projectId}`);
    await mkdir(workDir, { recursive: true });

    // TTS stage
    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: { status: "TTS_GENERATING", currentStage: "tts" },
    });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const isMiMo = user?.ttsProvider === "mimo";
    const edgeVoice = user?.ttsVoice || "zh-CN-YunxiNeural";

    // TTS with concurrency (3 parallel TTS calls)
    const TTS_CONCURRENCY = 3;
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
        const mimoApiKey = user?.aiApiKey || process.env.MIMO_API_KEY || "";
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
          console.warn(`[Render] MiMo TTS failed for scene ${i}, using silent audio (${estimatedDuration.toFixed(1)}s)`);
          try {
            await execFileAsync("ffmpeg", [
              "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
              "-t", String(estimatedDuration), "-c:a", "libmp3lame", "-b:a", "128k", audioFile,
            ], { timeout: 10000 });
          } catch {
            // Generate WAV silent audio as last resort
            const sampleRate = 44100;
            const numSamples = Math.ceil(estimatedDuration * sampleRate);
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
      } else {
        // Edge TTS with shell-based Python detection
        const ttsOk = await generateTTS(scene.voiceoverText, edgeVoice, audioFile);
        if (!ttsOk) {
          console.warn(`[Render] TTS failed for scene ${i}, using silent audio (${estimatedDuration.toFixed(1)}s)`);
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

    // Build a map of scene index → actual TTS audio duration
    const ttsDurationMap = new Map<number, number>();
    for (const result of ttsResults) {
      if (result) ttsDurationMap.set(result.index, result.duration);
    }

    // Materials stage
    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: { status: "MATERIALS_LOADING", currentStage: "materials" },
    });

    // Materials stage with concurrency (2 parallel material searches)
    const MATERIALS_CONCURRENCY = 2;
    await mapConcurrent(scenes, MATERIALS_CONCURRENCY, async (scene, i) => {
      const materialFile = join(workDir, `scene-${i}.mp4`);
      let materialLoaded = false;

      // Parse production meta (used by both auto-search and download)
      let meta: any = null;
      if (scene.productionMeta) {
        try { meta = JSON.parse(scene.productionMeta as string); } catch {}
      }
      const sourceVideos: string[] = meta?.sourceVideos || [];
      const materialQuery = meta?.materialQuery || scene.materialQuery || "";
      const visualDesc = meta?.visualDesc || scene.visualDesc || "";

      // ── Auto-search materials from Bilibili if none attached ──
      async function autoSearchBilibili(): Promise<boolean> {
        try {
          // ── Build prioritized search queries ──
          // Strategy: sourceVideos + visualDesc keywords > sourceVideos + materialQuery > visualDesc > materialQuery > properNouns > voiceover

          const abstractWords = new Set([
            "画面", "描述", "展现", "展示", "呈现", "表现", "体现", "反映",
            "风格", "色调", "氛围", "镜头", "光影", "构图", "采用", "运用",
            "使用", "适合", "需要", "可以", "强烈", "突出", "营造",
            "冷硬", "惨烈", "阴森", "压抑", "悲壮", "辉煌", "宏伟",
            "相关", "经典", "场景", "缓缓", "慢慢", "特写", "全景", "近景", "远景",
            "例如", "视频", "片段", "该部", "这部", "中的", "聚焦", "注重",
            "整体", "戏剧", "冲突", "悲剧", "色彩", "恐怖", "紧张", "庄严",
          ]);

          // Extract concrete scene keywords from visualDesc (people, actions, places, events)
          // Use 2-4 char segments for better Bilibili search matching
          function extractSceneKeywords(text: string): string[] {
            if (!text) return [];
            // First try to extract known concrete patterns
            const keywords: string[] = [];

            // Extract 《》 book/work names
            const workMatches = text.match(/《([^》]+)》/g) || [];
            workMatches.forEach((m: string) => {
              const name = m.replace(/[《》]/g, "");
              if (name.length >= 2 && name.length <= 8) keywords.push(name);
            });

            // Extract 2-4 char concrete nouns (shorter = better for search)
            const shortWords = text.match(/[\u4e00-\u9fff]{2,4}/g) || [];
            const seen = new Set(keywords);
            for (const w of shortWords) {
              if (seen.has(w)) continue;
              if (abstractWords.has(w)) continue;
              if (/^[一二三四五六七八九十百千万亿]+$/.test(w)) continue;
              // Filter out incomplete verb phrases (ends with 在/的/了/着/过/和/与)
              if (/[在的了着过和与及把被从向往]$/ .test(w)) continue;
              // Filter out common non-searchable words
              const nonSearchable = new Set([
                "这是", "那是", "他的", "她的", "我的", "这个", "那个", "这些", "那些",
                "最后", "首先", "然后", "接着", "同时", "此时", "画面", "镜头", "切换",
                "缓缓", "慢慢", "快速", "逐渐", "最终", "开始", "结束", "显示", "展示",
                "映照", "笼罩", "充满", "转为", "变为", "化为", "定格", "聚焦",
              ]);
              if (nonSearchable.has(w)) continue;
              keywords.push(w);
              seen.add(w);
              if (keywords.length >= 6) break;
            }

            return keywords.slice(0, 6);
          }

          // Extract concrete keywords from materialQuery
          function extractMaterialKeywords(query: string): string {
            if (!query) return "";
            if (query.length <= 20) return query;
            const words = query.match(/[一-鿿]{2,8}/g) || [];
            const concrete = words.filter((w: string) => !abstractWords.has(w));
            return concrete.length > 0
              ? [...new Set(concrete)].slice(0, 4).join(" ")
              : query.substring(0, 20);
          }

          const visualKeywords = extractSceneKeywords(visualDesc);
          const materialKeywords = extractMaterialKeywords(materialQuery);

          // Build ordered list of search queries to try
          const searchQueries: { query: string; label: string }[] = [];

          // Q1: sourceVideos + visualDesc scene keywords (MOST PRECISE — targets specific TV show + scene)
          if (sourceVideos.length > 0 && visualKeywords.length > 0) {
            searchQueries.push({
              query: `${sourceVideos[0]} ${visualKeywords.slice(0, 3).join(" ")}`,
              label: "剧名+画面关键词",
            });
          }

          // Q2: sourceVideos + materialQuery
          if (sourceVideos.length > 0 && materialKeywords) {
            searchQueries.push({
              query: `${sourceVideos[0]} ${materialKeywords}`,
              label: "剧名+检索词",
            });
          }

          // Q3: Try 2nd/3rd sourceVideos if available
          for (let si = 1; si < Math.min(sourceVideos.length, 3); si++) {
            if (visualKeywords.length > 0) {
              searchQueries.push({
                query: `${sourceVideos[si]} ${visualKeywords.slice(0, 3).join(" ")}`,
                label: `备选剧名${si}+画面关键词`,
              });
            }
          }

          // Q4: visualDesc keywords alone (without sourceVideos)
          if (visualKeywords.length > 0) {
            searchQueries.push({
              query: visualKeywords.join(" ") + " 电视剧",
              label: "画面关键词+电视剧",
            });
            searchQueries.push({
              query: visualKeywords.join(" ") + " 纪录片",
              label: "画面关键词+纪录片",
            });
          }

          // Q5: materialQuery alone
          if (materialKeywords) {
            searchQueries.push({
              query: materialKeywords,
              label: "检索词",
            });
          }

          // Q6: properNouns + era
          {
            const fallbackTerms: string[] = [];
            if (meta?.properNouns?.length) {
              const names = meta.properNouns.map((pn: any) => pn.name).filter(Boolean);
              fallbackTerms.push(...names);
            }
            if (meta?.era) {
              const eraWords = meta.era.match(/[\u4e00-\u9fff]{2,6}/g) || [];
              fallbackTerms.push(...eraWords);
            }
            if (fallbackTerms.length > 0) {
              searchQueries.push({
                query: [...new Set(fallbackTerms)].slice(0, 4).join(" ") + " 纪录片",
                label: "专有名词+纪录片",
              });
            }
          }

          // Q7: Last resort — voiceover text
          {
            const voiceText = scene.voiceoverText || scene.title || "";
            const voiceWords = voiceText.match(/[\u4e00-\u9fff]{2,6}/g) || [];
            const voiceStop = new Set(["然后", "为啥", "为什么", "不是", "今天", "肯定", "听过", "真实", "发生", "所有", "必须", "几乎", "只留", "一点"]);
            const filteredVoice = voiceWords.filter((w: string) => !voiceStop.has(w)).slice(0, 4);
            if (filteredVoice.length > 0) {
              searchQueries.push({
                query: filteredVoice.join(" ") + " 纪录片",
                label: "口播文本+纪录片",
              });
            }
          }

          console.log(`[Render] Scene ${i} search plan (${searchQueries.length} queries):`);
          searchQueries.forEach((sq, qi) => console.log(`  Q${qi + 1} [${sq.label}]: "${sq.query}"`));

          // Search with primary query first, fallback to secondary query
          async function bilibiliSearch(query: string, retries = 2): Promise<any[]> {
            if (!query) return [];
            for (let attempt = 0; attempt <= retries; attempt++) {
              try {
                if (attempt > 0) await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
                const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(query)}&page=1&page_size=20&order=totalrank`;
                const res = await fetch(url, {
                  headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Referer": "https://www.bilibili.com/",
                    "Origin": "https://www.bilibili.com",
                    "Accept": "application/json, text/plain, */*",
                    "Accept-Language": "zh-CN,zh;q=0.9",
                    "Cookie": "buvid3=infoc;",
                  },
                  signal: AbortSignal.timeout(10000),
                });
                if (!res.ok) continue;
                const text = await res.text();
                try {
                  const data = JSON.parse(text);
                  if (data.code !== 0) continue;
                  return (data.data?.result || []).slice(0, 20);
                } catch {
                  // Bilibili rate-limited → returned HTML, retry
                  if (text.startsWith("<")) continue;
                  return [];
                }
              } catch { continue; }
            }
            return [];
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

          // ── Execute search queries in priority order, stop at first match ──
          let matchedVideo: { bvid: string; streamUrl: string; title: string; pic: string; durSec: number; usedQuery: string } | null = null;

          for (const sq of searchQueries) {
            if (matchedVideo) break;
            const results = await bilibiliSearch(sq.query);
            console.log(`[Render] Scene ${i} Q[${sq.label}] "${sq.query}" → ${results.length} results`);

            for (const video of results) {
              if (matchedVideo) break;
              const bvid = video.bvid;
              if (!bvid) continue;

              const durParts = (video.duration || "0:00").split(":").map(Number);
              const durSec = durParts.length === 2 ? durParts[0]*60+durParts[1] : durParts[0]*3600+durParts[1]*60+durParts[2];
              const maxDuration = sourceVideos.length > 0 ? 1800 : 600;
              if (durSec < 5 || durSec > maxDuration) continue;

              let streamUrl: string | null = null;
              try {
                const infoRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
                  headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://www.bilibili.com/" },
                  signal: AbortSignal.timeout(8000),
                });
                if (infoRes.ok) {
                  const infoData = await infoRes.json();
                  const cid = infoData.data?.cid;
                  if (cid) {
                    const streamRes = await fetch(
                      `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=1`,
                      { headers: { "User-Agent": "Mozilla/5.0", "Referer": `https://www.bilibili.com/video/${bvid}` } }
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

              const title = video.title?.replace(/<[^>]*>/g, "") || sq.query;
              const pic = video.pic?.startsWith("//") ? `https:${video.pic}` : (video.pic || "");
              matchedVideo = { bvid, streamUrl, title, pic, durSec, usedQuery: sq.query };
              console.log(`[Render] Scene ${i} matched via [${sq.label}]: ${title.slice(0, 40)} (${durSec}s)`);
            }
          }

          // Save matched material to DB
          if (matchedVideo) {
            const material = await prisma.material.create({
              data: {
                projectId, name: matchedVideo.title.slice(0, 80),
                type: "VIDEO", source: "STOCK_FOOTAGE",
                fileUrl: matchedVideo.streamUrl, thumbnailUrl: matchedVideo.pic,
                width: 1920, height: 1080, duration: matchedVideo.durSec,
                externalId: `bilibili-${matchedVideo.bvid}`, externalSource: "bilibili",
                searchQuery: matchedVideo.usedQuery, matchScore: 0.8,
              },
            });
            await prisma.scene.update({ where: { id: scene.id }, data: { materialId: material.id } });
            scene.materialId = material.id;
            return true;
          } else {
            console.warn(`[Render] Scene ${i} no matching video found after all queries`);
          }
        } catch (err) {
          console.warn(`[Render] Scene ${i} Bilibili search failed:`, err instanceof Error ? err.message : err);
        }
        return false;
      }

      // Step 1: Auto-search if no material attached
      if (!scene.materialId) {
        await autoSearchBilibili();
      }

      // Step 2: Download existing material (from confirm route or auto-search)
      if (scene.materialId) {
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
                await new Promise(r => setTimeout(r, 1000 * attempt));
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

              // Bilibili stream URLs expire quickly — always refresh before download
              if (isBilibili) {
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
                      console.log(`[Render] Scene ${i} refreshed Bilibili stream URL`);
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

              // Watermark removal — dynamic detection based on actual video dimensions
              let processedPath = localPath;
              const needsWatermarkRemoval =
                (material.source !== "STOCK_FOOTAGE" && material.source !== "AI_GENERATED") ||
                material.externalSource === "bilibili" ||
                material.externalSource === "douyin";
              if (needsWatermarkRemoval) {
                const cleanPath = join(workDir, `clean-${i}.${ext}`);
                try {
                  // Probe actual dimensions for accurate watermark positioning
                  const dims = await probeDimensions(localPath);
                  if (dims.width > 0 && dims.height > 0) {
                    // Bilibili watermarks: top-right (UP主头像+ID), bottom-right (B站logo)
                    // Use targeted delogo for known watermark positions + crop edges
                    const isBilibili = material.externalSource === "bilibili";
                    const regions = isBilibili
                      ? [
                          // Top-right: UP主 info (larger area)
                          { x: Math.round(dims.width * 0.78), y: Math.round(dims.height * 0.01), width: Math.round(dims.width * 0.21), height: Math.round(dims.height * 0.08) },
                          // Bottom-right: B站 logo
                          { x: Math.round(dims.width * 0.82), y: Math.round(dims.height * 0.90), width: Math.round(dims.width * 0.17), height: Math.round(dims.height * 0.08) },
                          // Bottom-left: possible subtitle/credit
                          { x: Math.round(dims.width * 0.01), y: Math.round(dims.height * 0.90), width: Math.round(dims.width * 0.20), height: Math.round(dims.height * 0.08) },
                        ]
                      : detectWatermarkRegions(dims.width, dims.height);

                    // Build delogo filter chain from detected regions
                    const delogoFilters = regions.map(
                      (r) => `delogo=x=${r.x}:y=${r.y}:w=${r.width}:h=${r.height}:show=0`
                    );
                    // Crop 5% edges (increased from 3% for better watermark coverage) + denoise
                    const cropFilter = `crop=iw*0.90:ih*0.90:iw*0.05:ih*0.05,hqdn3d=2:2:3:3`;
                    const watermarkFilter = [...delogoFilters, cropFilter].join(",");

                    await execFileAsync("ffmpeg", [
                      "-y", "-i", localPath,
                      "-vf", watermarkFilter,
                      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                      "-an", cleanPath,
                    ], { timeout: 30000 });
                    processedPath = cleanPath;
                    console.log(`[Render] Scene ${i} watermark removed (${dims.width}x${dims.height}, ${regions.length} regions, ${isBilibili ? "bilibili" : "generic"})`);
                  }
                } catch {
                  // Fallback: aggressive crop if delogo fails
                  try {
                    await execFileAsync("ffmpeg", [
                      "-y", "-i", localPath,
                      "-vf", "crop=iw*0.88:ih*0.88:iw*0.06:ih*0.06",
                      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                      "-an", cleanPath,
                    ], { timeout: 30000 });
                    processedPath = cleanPath;
                    console.log(`[Render] Scene ${i} watermark fallback crop applied`);
                  } catch {}
                }
              }

              // Extract 5-7s highlight clip and force 16:9 output
              const targetW = config.width || 1920;
              const targetH = config.height || 1080;
              const scaleFilter = `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2:black`;

              if (ext === "jpg") {
                // Use estimated speech duration so image covers full voiceover
                // Add 30% buffer to ensure video is long enough for actual TTS audio
                const imgDuration = Math.max(8, Math.ceil(estimateAudioDuration(scenes[i].voiceoverText) * 1.3));
                await execFileAsync("ffmpeg", [
                  "-y", "-loop", "1", "-i", processedPath,
                  "-c:v", "libx264", "-t", String(imgDuration), "-pix_fmt", "yuv420p",
                  "-vf", scaleFilter,
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
                // Add 30% buffer to estimated duration to ensure video covers actual TTS
                const neededDuration = Math.ceil(estimateAudioDuration(scenes[i].voiceoverText) * 1.3);
                const needsLoop = videoDuration > 0 && videoDuration < neededDuration;
                if (videoDuration > 10 && !needsLoop) {
                  // Smart clip extraction: skip intro/outro, sample from middle
                  const clipLength = Math.min(Math.max(videoDuration * 0.15, neededDuration), videoDuration - 2);
                  let startSec: number;
                  if (videoDuration > 300) {
                    // Very long video (>5min): sample from 25%-75% range (skip intro/outro)
                    const rangeStart = videoDuration * 0.25;
                    const rangeEnd = videoDuration * 0.75 - clipLength;
                    startSec = Math.max(rangeStart, Math.min(videoDuration * 0.4, rangeEnd));
                  } else if (videoDuration > 60) {
                    // Medium video (1-5min): sample from 15%-60%
                    startSec = Math.max(videoDuration * 0.15, Math.min(videoDuration * 0.4, videoDuration - clipLength - 2));
                  } else {
                    // Short video (<1min): start at 10%
                    startSec = Math.max(1, videoDuration * 0.1);
                  }
                  const startTime = startSec.toFixed(2);
                  trimArgs = ["-ss", startTime, "-t", String(Math.round(clipLength))];
                  console.log(`[Render] Scene ${i} trimming ${clipLength.toFixed(1)}s from ${startTime}s (total ${videoDuration.toFixed(1)}s, need ${neededDuration}s)`);
                } else if (videoDuration > 0) {
                  console.log(`[Render] Scene ${i} video short (${videoDuration.toFixed(1)}s, need ${neededDuration}s), ${needsLoop ? "looping" : "using full clip"}`);
                }

                const loopArgs = needsLoop ? ["-stream_loop", "-1"] : [];

                // Cap output duration for looped videos
                const durationCap = needsLoop ? ["-t", String(neededDuration)] : [];

                await execFileAsync("ffmpeg", [
                  "-y", ...loopArgs, ...trimArgs, "-i", processedPath,
                  "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                  "-vf", scaleFilter,
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
        console.warn(`[Render] Scene ${i} all sources failed, using text placeholder`);
        // Generate a dark gradient-style background with scene title as text
        const sceneTitle = scene.title || `场景 ${scene.sceneNumber}`;
        const safeTitle = sceneTitle.replace(/['"\\:;%]/g, "");
        const safeVoice = (scene.voiceoverText || "").slice(0, 40).replace(/['"\\:;%]/g, "");
        const fontPath = "C\\:/Windows/Fonts/msyh.ttc";
        const midY = Math.round(config.height / 2);
        await execFileAsync("ffmpeg", [
          "-y", "-f", "lavfi", "-i",
          `color=c=0x1a1a2e:s=${config.width}x${config.height}:d=60,drawtext=fontfile='${fontPath}':fontsize=48:fontcolor=white@0.8:x=(w-text_w)/2:y=${midY-80}:text='${safeTitle}',drawtext=fontfile='${fontPath}':fontsize=32:fontcolor=white@0.5:x=(w-text_w)/2:y=${midY}:text='${safeVoice}'`,
          "-c:v", "libx264", "-t", "60", "-pix_fmt", "yuv420p",
          "-an", materialFile,
        ], { timeout: 15000 });
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

    const inputArgs: string[] = [];
    const filterParts: string[] = [];
    const concatInputs: string[] = [];
    let totalDuration = 0; // accumulated actual audio durations

    for (let i = 0; i < scenes.length; i++) {
      const materialFile = join(workDir, `scene-${i}.mp4`);
      const audioFile = join(workDir, `tts-${i}.mp3`);

      // Ensure files exist
      let hasMaterial = true;
      try { await readFile(materialFile); } catch { hasMaterial = false; }
      if (!hasMaterial) {
        const sceneTitle = scenes[i].title || `场景 ${scenes[i].sceneNumber}`;
        const safeTitle = sceneTitle.replace(/['"\\:;%]/g, "");
        const fontPath = "C\\:/Windows/Fonts/msyh.ttc";
        const midY = Math.round(config.height / 2);
        // Generate 60s placeholder — long enough for any TTS duration
        await execFileAsync("ffmpeg", [
          "-y", "-f", "lavfi", "-i",
          `color=c=0x1a1a2e:s=${config.width}x${config.height}:d=60,drawtext=fontfile='${fontPath}':fontsize=48:fontcolor=white@0.6:x=(w-text_w)/2:y=${midY}:text='${safeTitle}'`,
          "-c:v", "libx264", "-t", "60", "-pix_fmt", "yuv420p",
          "-an", materialFile,
        ], { timeout: 15000 });
      }

      let hasAudio = true;
      try { await readFile(audioFile); } catch { hasAudio = false; }
      if (!hasAudio) {
        console.warn(`[Render] Compose: audio missing for scene ${i}, generating fallback`);
        const estimatedDur = estimateAudioDuration(scenes[i].voiceoverText);
        try {
          await execFileAsync("ffmpeg", [
            "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
            "-t", String(estimatedDur), "-c:a", "libmp3lame", "-b:a", "128k", audioFile,
          ], { timeout: 10000 });
        } catch {
          // Generate proper silent WAV
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

      inputArgs.push("-i", materialFile, "-i", audioFile);

      const videoIdx = i * 2;
      const audioIdx = i * 2 + 1;

      // Use actual TTS duration from TTS stage (most reliable source)
      // Fallback chain: ttsDurationMap → ffprobe → estimate
      let audioDuration = ttsDurationMap.get(i) || 0;
      if (audioDuration <= 0) {
        const probedDuration = await getAudioDuration(audioFile);
        audioDuration = probedDuration > 0 ? probedDuration : estimateAudioDuration(scenes[i].voiceoverText);
      }
      // Ensure minimum duration
      audioDuration = Math.max(audioDuration, 0.5);

      console.log(`[Render] Compose scene ${i}: audioDuration=${audioDuration.toFixed(2)}s (source: ${ttsDurationMap.get(i) ? "tts-stage" : "fallback"})`);

      // Generate subtitles proportional to actual audio duration
      let scripts: string[] | undefined;
      if (scenes[i].productionMeta) {
        try {
          const meta = JSON.parse(scenes[i].productionMeta as string);
          if (meta.scripts?.length) scripts = meta.scripts;
        } catch {}
      }

      const subtitleConfig: SubtitleConfig = {
        videoWidth: config.width,
        videoHeight: config.height,
        audioDuration,
      };
      const subtitleChunks = generateSubtitleChunks(
        scenes[i].voiceoverText,
        subtitleConfig,
        scripts
      );

      // Scale video and pad/loop to match audio duration exactly
      // tpad extends short videos by cloning last frame; trim ensures exact duration
      // Note: tpad uses stop_duration (not duration) for time-based padding
      const audioDurStr = audioDuration.toFixed(3);
      filterParts.push(
        `[${videoIdx}:v]scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,tpad=stop=-1:stop_mode=clone:stop_duration=${audioDurStr},trim=duration=${audioDurStr},setpts=PTS-STARTPTS[v${i}]`
      );

      // Audio: boost volume, resample, trim to exact duration
      filterParts.push(
        `[${audioIdx}:a]volume=2.0,aresample=44100,atrim=0:${audioDurStr},asetpts=PTS-STARTPTS[a${i}]`
      );

      // Build subtitle filter chain from pre-generated chunks
      const { filterParts: subFilters, outputLabel: subLabel } = buildSubtitleFilterChain(
        `v${i}`,
        subtitleChunks,
        subtitleConfig
      );
      filterParts.push(...subFilters);

      // Update scene with final duration (may be extended for subtitle readability)
      await prisma.scene.update({
        where: { id: scenes[i].id },
        data: { audioDuration },
      });

      totalDuration += audioDuration;

      concatInputs.push(`[${subLabel}][a${i}]`);
    }

    if (concatInputs.length === 0) throw new Error("No scenes to compose");

    filterParts.push(
      `${concatInputs.join("")}concat=n=${concatInputs.length}:v=1:a=1[outv][outa]`
    );

    let finalAudioMap = "[outa]";

    // Background music
    if (project.musicTracks.length > 0) {
      const music = project.musicTracks[0];
      if (music.fileUrl) {
        const musicFile = join(workDir, "bgm.mp3");
        try {
          const res = await fetch(music.fileUrl);
          if (res.ok) {
            await writeFile(musicFile, Buffer.from(await res.arrayBuffer()));
            inputArgs.push("-i", musicFile);
            const musicIdx = scenes.length * 2;

            filterParts.push(
              `[${musicIdx}:a]volume=${music.volume},afade=t=in:st=0:d=${music.fadeIn},afade=t=out:st=${totalDuration - music.fadeOut}:d=${music.fadeOut}[bgm]`
            );
            filterParts.push(
              `[outa][bgm]amix=inputs=2:duration=first:dropout_transition=2[finala]`
            );
            finalAudioMap = "[finala]";
          }
        } catch {}
      }
    }

    await execFileAsync("ffmpeg", [
      "-y", ...inputArgs,
      "-filter_complex", filterParts.join(";"),
      "-map", "[outv]", "-map", finalAudioMap,
      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
      "-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2",
      "-r", String(config.fps),
      "-movflags", "+faststart",
      outputPath,
    ], { timeout: 600000 });

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
    const videoBuffer = await readFile(outputPath);

    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: {
        status: "COMPLETED",
        outputUrl,
        outputFormat: config.format,
        outputSize: videoBuffer.length,
        outputDuration: duration,
        completedAt: new Date(),
        progress: 100,
      },
    });

    await prisma.project.update({
      where: { id: projectId },
      data: { status: "COMPLETED" },
    });

    await rm(workDir, { recursive: true, force: true }).catch(() => {});

    return { outputUrl, duration };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: { status: "FAILED", errorMessage: message },
    });
    await prisma.project.update({
      where: { id: projectId },
      data: { status: "FAILED" },
    });
    throw error;
  }
}
