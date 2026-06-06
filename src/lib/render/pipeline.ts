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

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const audioFile = join(workDir, `tts-${i}.mp3`);

      // Skip TTS only if audioUrl exists AND the file is still on disk
      if (scene.audioUrl) {
        try {
          await readFile(audioFile);
          continue; // File exists, skip TTS
        } catch {
          // File was cleaned up, need to regenerate
          console.warn(`[Render] Scene ${i} audioUrl set but file missing, regenerating TTS`);
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

      await prisma.scene.update({
        where: { id: scene.id },
        data: { audioUrl: audioFile, audioDuration: estimateAudioDuration(scene.voiceoverText) },
      });
    }

    // Materials stage
    await prisma.renderJob.update({
      where: { id: renderJob.id },
      data: { status: "MATERIALS_LOADING", currentStage: "materials" },
    });

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const materialFile = join(workDir, `scene-${i}.mp4`);
      let materialLoaded = false;

      // Auto-search materials from Bilibili if none attached
      if (!scene.materialId) {
        try {
          // Parse production meta
          let meta: any = null;
          if (scene.productionMeta) {
            try { meta = JSON.parse(scene.productionMeta as string); } catch {}
          }

          // Build search queries
          // Priority: materialQuery (AI-generated) > visualDesc work names > properNouns > voiceover text
          let primaryQuery = "";
          let secondaryQuery = "";

          // 1. materialQuery — AI-generated search term, HIGHEST priority
          const materialQuery = meta?.materialQuery || scene.materialQuery || "";
          if (materialQuery) {
            primaryQuery = materialQuery;
          }

          // 2. visualDesc — extract concrete work names (《xxx》) or historical figures/events
          const visualDesc = meta?.visualDesc || scene.visualDesc || "";
          if (!primaryQuery && visualDesc) {
            // 2a. Extract 影视作品 names from 《书名号》
            const workMatches = visualDesc.match(/《([^》]+)》/g) || [];
            const workNames = workMatches.map((m: string) => m.replace(/[《》]/g, ""));
            if (workNames.length > 0) {
              primaryQuery = workNames.slice(0, 2).join(" ") + " 纪录片";
            }

            // 2b. No 书名号 — extract meaningful concrete nouns (people, places, events, eras)
            if (!primaryQuery) {
              // Match Chinese words, but filter out abstract/generic terms
              const allWords = visualDesc.match(/[\u4e00-\u9fff]{2,10}/g) || [];
              const abstractWords = new Set([
                "画面", "描述", "展现", "展示", "呈现", "表现", "体现", "反映",
                "相关", "经典", "场景", "镜头", "光影", "色调", "氛围", "风格",
                "构图", "缓缓", "慢慢", "特写", "全景", "近景", "远景",
                "采用", "运用", "使用", "适合", "需要", "可以", "例如",
                "视频", "片段", "该部", "这部", "相关", "中的",
              ]);
              // Keep concrete terms: history figures, dynasties, battles, places
              const concreteWords = allWords.filter((w: string) => {
                if (abstractWords.has(w)) return false;
                if (/^[一二三四五六七八九十百千万亿]+$/.test(w)) return false; // pure numbers
                if (w.length < 2 || w.length > 8) return false;
                return true;
              });
              if (concreteWords.length > 0) {
                primaryQuery = [...new Set(concreteWords)].slice(0, 4).join(" ") + " 纪录片";
              }
            }
          }

          // 3. properNouns + era — concrete historical entities
          if (!primaryQuery) {
            const fallbackTerms: string[] = [];
            if (meta?.properNouns?.length) {
              const names = meta.properNouns.map((pn: any) => pn.name).filter(Boolean);
              fallbackTerms.push(...names);
            }
            if (meta?.era) {
              // Extract dynasty/era like "明朝", "清朝", "清初"
              const eraWords = meta.era.match(/[\u4e00-\u9fff]{2,6}/g) || [];
              fallbackTerms.push(...eraWords);
            }
            if (fallbackTerms.length > 0) {
              primaryQuery = [...new Set(fallbackTerms)].slice(0, 4).join(" ") + " 纪录片";
            }
          }

          // 4. Secondary query from sources + era (concrete sources like "中国通史")
          const contextText = [
            meta?.sources?.join(" ") || "",
            meta?.era || "",
          ].join(" ");
          if (contextText) {
            const phrases = contextText.match(/[\u4e00-\u9fff]{2,8}/g) || [];
            const stopWords = new Set(["色调", "镜头", "风格", "突出", "展现", "场景", "聚焦", "注重",
              "描述", "画面", "整体", "氛围", "采用", "运用", "使用", "适合", "需要", "可以",
              "纪录片", "电视剧", "电影", "视频", "来源"]);
            const contextTerms = phrases
              .filter((p: string) => !stopWords.has(p) && p.length >= 2)
              .slice(0, 4);
            secondaryQuery = [...new Set(contextTerms)].join(" ");
          }

          // 5. Last resort: voiceover text
          if (!primaryQuery && !secondaryQuery) {
            const voiceText = scene.voiceoverText || scene.title || "";
            // Extract concrete nouns from voiceover (simple approach: take first few 2-4 char words)
            const voiceWords = voiceText.match(/[\u4e00-\u9fff]{2,6}/g) || [];
            const voiceStop = new Set(["然后", "为啥", "为什么", "不是", "今天", "肯定", "听过", "不是", "真实", "发生", "所有", "必须", "几乎", "只留", "一点"]);
            const filteredVoice = voiceWords.filter((w: string) => !voiceStop.has(w)).slice(0, 4);
            primaryQuery = filteredVoice.join(" ") || voiceText.slice(0, 20) || "历史";
          }

          console.log(`[Render] Scene ${i} search: primary="${primaryQuery.slice(0, 50)}" secondary="${secondaryQuery.slice(0, 50)}"`);

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

          // Try primary query first (based on visualDesc)
          let results = await bilibiliSearch(primaryQuery);

          // Fallback to secondary query if primary returns nothing
          if (results.length === 0 && secondaryQuery) {
            console.log(`[Render] Scene ${i} primary query empty, trying secondary context query`);
            results = await bilibiliSearch(secondaryQuery);
          }

          // Last resort: combine both
          if (results.length === 0 && primaryQuery && secondaryQuery) {
            results = await bilibiliSearch(`${primaryQuery} ${secondaryQuery}`);
          }

          // Super-broad fallback: search with just the era + "纪录片"
          if (results.length === 0 && meta?.era) {
            const eraWords = meta.era.match(/[\u4e00-\u9fff]{2,6}/g) || [];
            const broadQuery = eraWords.slice(0, 2).join(" ") + " 历史 纪录片";
            console.log(`[Render] Scene ${i} all specific queries empty, trying broad: "${broadQuery}"`);
            results = await bilibiliSearch(broadQuery);
          }

          console.log(`[Render] Scene ${i} Bilibili found ${results.length} videos`);

          // Find first 16:9 usable video
          for (const video of results) {
            if (materialLoaded) break;
            const bvid = video.bvid;
            if (!bvid) continue;

            const durParts = (video.duration || "0:00").split(":").map(Number);
            const durSec = durParts.length === 2 ? durParts[0]*60+durParts[1] : durParts[0]*3600+durParts[1]*60+durParts[2];
            if (durSec < 5 || durSec > 600) continue;

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

            // Validate 16:9 aspect ratio before saving
            const probePath = join(workDir, `probe-${i}-${bvid}.mp4`);
            let ratio = 1.78; // default: assume 16:9 if probe fails
            try {
              const ok = await quickDownloadHead(streamUrl, probePath, 524288); // 512KB head
              if (ok) {
                const reso = await probeVideoResolution(probePath);
                if (reso) {
                  ratio = reso.width / reso.height;
                  console.log(`[Render] Scene ${i} candidate [${bvid}] ${reso.width}x${reso.height} ratio=${ratio.toFixed(2)}`);
                } else {
                  console.log(`[Render] Scene ${i} candidate [${bvid}] probe failed, assume landscape`);
                }
              } else {
                console.log(`[Render] Scene ${i} candidate [${bvid}] quick download failed`);
              }
            } catch (probeErr) {
              console.warn(`[Render] Scene ${i} candidate [${bvid}] probe error:`, probeErr instanceof Error ? probeErr.message : probeErr);
            } finally {
              try { await unlink(probePath); } catch {}
            }

            // Accept landscape or near-landscape videos (ratio >= 1.2, i.e. 4:3 or wider)
            // Reject extreme portrait (9:16 = 0.56) and square (1:1) which lose too much when padded to 16:9
            if (ratio < 1.2) {
              console.log(`[Render] Scene ${i} candidate [${bvid}] skipped (ratio ${ratio.toFixed(2)} too narrow for 16:9 pad)`);
              continue;
            }

            // Save validated material
            const title = video.title?.replace(/<[^>]*>/g, "") || primaryQuery;
            const pic = video.pic?.startsWith("//") ? `https:${video.pic}` : (video.pic || "");
            const usedQuery = results.length > 0 ? (primaryQuery || secondaryQuery) : "";
            const material = await prisma.material.create({
              data: {
                projectId, name: title.slice(0, 80),
                type: "VIDEO", source: "STOCK_FOOTAGE",
                fileUrl: streamUrl, thumbnailUrl: pic,
                width: 1920, height: 1080, duration: durSec,
                externalId: `bilibili-${bvid}`, externalSource: "bilibili",
                searchQuery: usedQuery, matchScore: 0.8,
              },
            });
            await prisma.scene.update({ where: { id: scene.id }, data: { materialId: material.id } });
            scene.materialId = material.id;
            materialLoaded = true;
            console.log(`[Render] Scene ${i} matched: ${title.slice(0, 40)} (${durSec}s)`);
          }
        } catch (err) {
          console.warn(`[Render] Scene ${i} Bilibili search failed:`, err instanceof Error ? err.message : err);
        }
      }

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

              // Bilibili stream URLs expire — refresh on first attempt if needed
              if (isBilibili && attempt > 0) {
                const bvidMatch = material.externalId?.match(/bilibili-(.+)/);
                const bvid = bvidMatch?.[1];
                if (bvid) {
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
                          const newUrl = streamData.data?.durl?.[0]?.url;
                          if (newUrl) {
                            fileUrl = newUrl;
                            await prisma.material.update({
                              where: { id: material.id },
                              data: { fileUrl: newUrl },
                            });
                            console.log(`[Render] Scene ${i} refreshed Bilibili stream URL`);
                          }
                        }
                      }
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
                    const regions = detectWatermarkRegions(dims.width, dims.height);
                    // Build delogo filter chain from detected regions
                    const delogoFilters = regions.map(
                      (r) => `delogo=x=${r.x}:y=${r.y}:w=${r.width}:h=${r.height}:show=0`
                    );
                    // Crop 3% edges + denoise to blur faint marks
                    const cropFilter = `crop=iw*0.94:ih*0.94:iw*0.03:ih*0.03,hqdn3d=2:2:3:3`;
                    const watermarkFilter = [...delogoFilters, cropFilter].join(",");

                    await execFileAsync("ffmpeg", [
                      "-y", "-i", localPath,
                      "-vf", watermarkFilter,
                      "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                      "-an", cleanPath,
                    ], { timeout: 30000 });
                    processedPath = cleanPath;
                    console.log(`[Render] Scene ${i} watermark removed (${dims.width}x${dims.height}, ${regions.length} regions)`);
                  }
                } catch {
                  // Fallback: aggressive crop if delogo fails
                  try {
                    await execFileAsync("ffmpeg", [
                      "-y", "-i", localPath,
                      "-vf", "crop=iw*0.92:ih*0.92:iw*0.04:ih*0.04",
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
                const imgDuration = Math.max(5, Math.ceil(estimateAudioDuration(scenes[i].voiceoverText)));
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
                const neededDuration = Math.ceil(estimateAudioDuration(scenes[i].voiceoverText));
                const needsLoop = videoDuration > 0 && videoDuration < neededDuration;
                if (videoDuration > 10 && !needsLoop) {
                  // Long enough video: extract a highlight clip at least neededDuration long
                  const clipLength = Math.min(Math.max(videoDuration * 0.15, neededDuration), videoDuration - 2);
                  const maxStart = videoDuration - clipLength - 2;
                  const startSec = Math.max(1, Math.min(videoDuration * 0.2, maxStart));
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
          console.warn(`[Render] Scene ${i} material record not found: ${scene.materialId}`);
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
    }

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
        await execFileAsync("ffmpeg", [
          "-y", "-f", "lavfi", "-i",
          `color=c=0x1a1a2e:s=${config.width}x${config.height}:d=5,drawtext=fontfile='${fontPath}':fontsize=48:fontcolor=white@0.6:x=(w-text_w)/2:y=(h-text_h)/2:text='${safeTitle}'`,
          "-c:v", "libx264", "-t", "5", "-pix_fmt", "yuv420p",
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

      // Get actual audio duration for precise video trim + subtitle sync
      const audioFileDuration = await getAudioDuration(audioFile);
      const originalAudioDuration = audioFileDuration > 0
        ? audioFileDuration
        : estimateAudioDuration(scenes[i].voiceoverText);
      let audioDuration = originalAudioDuration;

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

      // Scale video and trim to duration
      filterParts.push(
        `[${videoIdx}:v]scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease,pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,trim=duration=${audioDuration},setpts=PTS-STARTPTS[v${i}]`
      );

      // Audio: boost volume, resample, trim
      filterParts.push(
        `[${audioIdx}:a]volume=2.0,aresample=44100,atrim=0:${audioDuration},asetpts=PTS-STARTPTS[a${i}]`
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
