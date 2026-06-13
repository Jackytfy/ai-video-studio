import { searchVideos, searchImages } from "./pexels";
import { searchPixabayVideos, searchPixabayImages } from "./pixabay";
import { searchBilibiliMaterials } from "./bilibili";

export interface MaterialResult {
  externalId: string;
  type: "VIDEO" | "IMAGE";
  source: "STOCK_FOOTAGE";
  fileUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  duration?: number;
  matchScore: number;
  searchQuery: string;
  platform: "pexels" | "pixabay" | "bilibili" | "douyin";
  needsWatermarkRemoval?: boolean;
}

export interface SceneSearchContext {
  sceneNumber: number;
  materialQuery: string;
  materialQueryEn?: string;
  visualDesc?: string;
  sourceVideos?: string[];
}

/**
 * Extract concrete 2-4 char keywords from visualDesc for Bilibili search.
 * Filters out abstract words, incomplete phrases, and non-searchable terms.
 */
function extractVisualDescKeywords(text: string): string[] {
  if (!text) return [];
  const abstractWords = new Set([
    "画面", "描述", "展现", "展示", "呈现", "表现", "体现", "反映",
    "风格", "色调", "氛围", "镜头", "光影", "构图", "采用", "运用",
    "使用", "适合", "需要", "可以", "强烈", "突出", "营造",
    "冷硬", "惨烈", "阴森", "压抑", "悲壮", "辉煌", "宏伟",
    "戏剧", "冲突", "悲剧", "色彩", "恐怖", "紧张", "庄严",
    "例如", "视频", "片段", "该部", "这部", "中的", "聚焦", "注重",
    "整体", "相关", "经典", "场景", "缓缓", "慢慢", "快速", "逐渐",
    "最终", "开始", "结束", "显示", "映照", "笼罩", "充满", "转为",
    "变为", "化为", "定格", "切换", "这是", "那是", "他的", "她的",
    "我的", "这个", "那个", "这些", "那些", "最后", "首先", "然后",
    "接着", "同时", "此时", "近景", "远景", "全景", "特写",
  ]);
  const nonSearchable = new Set([
    "这是", "那是", "他的", "她的", "我的", "这个", "那个", "这些", "那些",
    "最后", "首先", "然后", "接着", "同时", "此时", "画面", "镜头", "切换",
    "缓缓", "慢慢", "快速", "逐渐", "最终", "开始", "结束", "显示", "展示",
    "映照", "笼罩", "充满", "转为", "变为", "化为", "定格", "聚焦",
  ]);

  const keywords: string[] = [];
  const shortWords = text.match(/[\u4e00-\u9fff]{2,4}/g) || [];
  const seen = new Set<string>();
  for (const w of shortWords) {
    if (seen.has(w)) continue;
    if (abstractWords.has(w) || nonSearchable.has(w)) continue;
    if (/^[一二三四五六七八九十百千万亿]+$/.test(w)) continue;
    if (/[在的了着过和与及把被从向往]$/.test(w)) continue;
    keywords.push(w);
    seen.add(w);
    if (keywords.length >= 6) break;
  }
  return keywords;
}

/**
 * Build prioritized search queries for a scene.
 * Returns an array of {query, label} sorted by priority (most precise first).
 */
function buildSearchQueries(ctx: SceneSearchContext): { query: string; label: string }[] {
  const queries: { query: string; label: string }[] = [];
  const sourceVideos = ctx.sourceVideos || [];
  const materialKeywords = ctx.materialQuery || "";
  const visualKeywords = extractVisualDescKeywords(ctx.visualDesc || "");

  // Q1: sourceVideos + visualDesc keywords (MOST PRECISE)
  if (sourceVideos.length > 0 && visualKeywords.length > 0) {
    queries.push({
      query: `${sourceVideos[0]} ${visualKeywords.slice(0, 3).join(" ")}`,
      label: "剧名+画面关键词",
    });
  }
  // Q2: sourceVideos + materialQuery
  if (sourceVideos.length > 0 && materialKeywords) {
    queries.push({
      query: `${sourceVideos[0]} ${materialKeywords}`,
      label: "剧名+检索词",
    });
  }
  // Q3: sourceVideos alone (if no other keywords)
  if (sourceVideos.length > 0 && visualKeywords.length === 0 && !materialKeywords) {
    queries.push({
      query: sourceVideos[0],
      label: "剧名",
    });
  }
  // Q4: visualDesc keywords + 电视剧/纪录片
  if (visualKeywords.length > 0) {
    queries.push({
      query: `${visualKeywords.join(" ")} 电视剧`,
      label: "画面关键词+电视剧",
    });
    queries.push({
      query: `${visualKeywords.join(" ")} 纪录片`,
      label: "画面关键词+纪录片",
    });
  }
  // Q5: materialQuery alone
  if (materialKeywords) {
    queries.push({
      query: materialKeywords,
      label: "检索词",
    });
  }

  return queries;
}

/**
 * Extract Chinese search keywords for Bilibili.
 * Now uses prioritized multi-query strategy for better match.
 */
export function extractChineseSearchQuery(ctx: SceneSearchContext): string {
  const queries = buildSearchQueries(ctx);
  // Return the highest-priority query
  return queries.length > 0 ? queries[0].query : ctx.materialQuery || "";
}

/**
 * Extract English search keywords from a scene context.
 * Priority: materialQueryEn (from AI) > extract from materialQuery > visualDesc concepts > generic fallback
 */
function extractSearchKeywords(ctx: SceneSearchContext): string[] {
  if (ctx.materialQueryEn) {
    return [ctx.materialQueryEn];
  }

  const englishWords = ctx.materialQuery.match(/[a-zA-Z]+/g);
  if (englishWords && englishWords.length >= 2) {
    return [englishWords.join(" ")];
  }

  // Also check visualDesc for English words
  if (ctx.visualDesc) {
    const visWords = ctx.visualDesc.match(/[a-zA-Z]+/g);
    if (visWords && visWords.length >= 2) {
      return [visWords.join(" ")];
    }
  }

  const queries: string[] = [];
  const searchText = ctx.materialQuery + " " + (ctx.visualDesc || "");
  const conceptMap: Record<string, string> = {
    "战场": "battlefield war", "战争": "war battle", "军事": "military army",
    "古代": "ancient historical", "历史": "history historical",
    "宫殿": "palace imperial", "皇城": "imperial city palace", "宫廷": "palace imperial court",
    "紫禁城": "forbidden city palace", "皇": "imperial royal", "帝": "emperor imperial",
    "马": "horse riding", "骑马": "horse riding cavalry",
    "将军": "general warrior", "士兵": "soldier army",
    "城": "castle fortress city", "城墙": "castle wall fortress",
    "山河": "mountains rivers landscape", "山": "mountain landscape",
    "河": "river water", "海": "ocean sea",
    "日出": "sunrise", "日落": "sunset", "夜景": "night scene",
    "星空": "starry sky", "海洋": "ocean sea", "森林": "forest",
    "沙漠": "desert", "雪景": "snow winter", "城市": "city urban skyline",
    "科技": "technology", "未来": "futuristic", "太空": "space cosmos",
    "冷峻": "cold dramatic", "肃杀": "dramatic intense",
    "紧张": "tense dramatic", "壮丽": "majestic grand",
    "史诗": "epic cinematic", "写实": "realistic cinematic",
    "航拍": "aerial drone", "特写": "close-up detail",
    "远景": "wide shot landscape", "纪录片": "documentary",
    "金色": "golden", "铠甲": "armor warrior", "武士": "warrior knight",
    "旌旗": "banner flag army", "硝烟": "smoke battle",
    "冲锋": "charge attack", "宫殿群": "palace complex",
    "琉璃瓦": "golden roof palace", "红墙": "red wall palace",
    "阳光": "sunlight bright", "辉煌": "glorious magnificent",
    "阴云": "storm clouds dramatic", "逆光": "backlight silhouette",
    "夕阳": "sunset golden hour", "夜": "night dark",
    "水": "water ocean", "火": "fire flame",
    // History / Dynasty terms
    "北疆": "northern frontier desert", "边塞": "border fortress great wall",
    "藩王": "ancient chinese warlord kingdom", "削藩": "military conflict power struggle",
    "明朝": "ancient china ming dynasty", "大明": "ming dynasty imperial china",
    "洪武": "ancient chinese emperor palace", "永乐": "imperial china forbidden city",
    "朱棣": "ancient chinese emperor warrior", "朱元璋": "ancient chinese emperor founder",
    "太子": "crown prince imperial court", "皇位": "imperial throne palace",
    "漠北": "mongolia desert grassland", "蒙古": "mongolia steppe nomadic",
    "大都": "ancient beijing imperial capital",
    "戈壁": "gobi desert wilderness",
    "戍边": "frontier fortress ancient", "疆": "border frontier fortress",
    "广角": "wide angle landscape epic", "宏大": "epic cinematic grand",
    "压抑": "dark moody atmospheric", "孤绝": "lonely dramatic solitude",
    "暖色调": "warm golden sunlight", "冷色调": "cold blue dramatic",
    "蓝灰": "blue grey moody", "土黄": "earth tone desert yellow",
    "冲击力": "dramatic intense action", "沉稳": "solemn dignified stable",
    "权力": "power authority dramatic", "阴谋": "dark conspiracy intrigue",
    "冲突": "conflict battle dramatic", "继承": "succession legacy heritage",
  };

  const matchedKeywords: string[] = [];
  for (const [cn, en] of Object.entries(conceptMap)) {
    if (searchText.includes(cn)) {
      matchedKeywords.push(en);
    }
  }

  if (matchedKeywords.length > 0) {
    queries.push(matchedKeywords.slice(0, 4).join(" "));
  }

  if (queries.length === 0) {
    // Try broader terms: use top 2 most common concepts
    queries.push("cinematic dramatic landscape");
    queries.push("nature sky clouds");
  }

  return queries;
}

/**
 * Score a material result based on relevance.
 */
function scoreMaterial(
  material: { width: number; height: number; duration?: number },
  _ctx: SceneSearchContext
): number {
  let score = 0.5;

  if (material.width >= 1920 || material.height >= 1080) score += 0.2;
  else if (material.width >= 1280 || material.height >= 720) score += 0.1;

  if (material.duration) {
    if (material.duration >= 5 && material.duration <= 30) score += 0.2;
    else if (material.duration >= 3 && material.duration <= 60) score += 0.1;
  }

  return Math.min(1, score);
}

/**
 * Search Pexels for videos and images.
 */
async function searchPexelsSource(
  keywords: string,
  count: number,
  ctx: SceneSearchContext
): Promise<MaterialResult[]> {
  const results: MaterialResult[] = [];

  try {
    const videos = await searchVideos(keywords, count);
    for (const video of videos) {
      // Prefer HD+ quality, then any file >= 1280 wide, then largest available
      const bestFile = video.video_files.find((f) => f.quality === "hd" && f.width >= 1280) ||
        video.video_files.find((f) => f.width >= 1920) ||
        video.video_files.find((f) => f.width >= 1280) ||
        video.video_files.sort((a, b) => b.width - a.width)[0];
      if (!bestFile) continue;

      results.push({
        externalId: `pexels-${video.id}`,
        type: "VIDEO",
        source: "STOCK_FOOTAGE",
        fileUrl: bestFile.link,
        thumbnailUrl: video.image,
        width: bestFile.width,
        height: bestFile.height,
        duration: video.duration,
        matchScore: scoreMaterial({ width: bestFile.width, height: bestFile.height, duration: video.duration }, ctx),
        searchQuery: keywords,
        platform: "pexels",
      });
    }
  } catch (err) {
    console.error(`Pexels video search failed for "${keywords}":`, err);
  }

  try {
    const images = await searchImages(keywords, count);
    for (const img of images) {
      results.push({
        externalId: `pexels-${img.id}`,
        type: "IMAGE",
        source: "STOCK_FOOTAGE",
        fileUrl: img.src.large,
        thumbnailUrl: img.src.medium,
        width: img.width,
        height: img.height,
        matchScore: scoreMaterial({ width: img.width, height: img.height }, ctx) * 0.8,
        searchQuery: keywords,
        platform: "pexels",
      });
    }
  } catch (err) {
    console.error(`Pexels image search failed for "${keywords}":`, err);
  }

  return results;
}

/**
 * Search Pixabay for videos and images.
 */
async function searchPixabaySource(
  keywords: string,
  count: number,
  ctx: SceneSearchContext
): Promise<MaterialResult[]> {
  const results: MaterialResult[] = [];

  try {
    const videos = await searchPixabayVideos(keywords, count);
    for (const video of videos) {
      const bestFile = video.videos.large || video.videos.medium || video.videos.small;
      if (!bestFile) continue;

      results.push({
        externalId: `pixabay-${video.id}`,
        type: "VIDEO",
        source: "STOCK_FOOTAGE",
        fileUrl: bestFile.url,
        thumbnailUrl: `https://i.vimeocdn.com/video/${video.picture_id}_640x360.jpg`,
        width: bestFile.width,
        height: bestFile.height,
        duration: video.duration,
        matchScore: scoreMaterial({ width: bestFile.width, height: bestFile.height, duration: video.duration }, ctx),
        searchQuery: keywords,
        platform: "pixabay",
      });
    }
  } catch (err) {
    // Pixabay key not configured is expected
    if (!(err instanceof Error && err.message.includes("not configured"))) {
      console.error(`Pixabay video search failed for "${keywords}":`, err);
    }
  }

  try {
    const images = await searchPixabayImages(keywords, count);
    for (const img of images) {
      results.push({
        externalId: `pixabay-${img.id}`,
        type: "IMAGE",
        source: "STOCK_FOOTAGE",
        fileUrl: img.largeImageURL,
        thumbnailUrl: img.webformatURL,
        width: img.imageWidth,
        height: img.imageHeight,
        matchScore: scoreMaterial({ width: img.imageWidth, height: img.imageHeight }, ctx) * 0.8,
        searchQuery: keywords,
        platform: "pixabay",
      });
    }
  } catch (err) {
    if (!(err instanceof Error && err.message.includes("not configured"))) {
      console.error(`Pixabay image search failed for "${keywords}":`, err);
    }
  }

  return results;
}

/**
 * Search Bilibili for Chinese content videos.
 * Bilibili results have watermarks and lower match score.
 */
async function searchBilibiliSource(
  keywords: string,
  count: number
): Promise<MaterialResult[]> {
  try {
    const results = await searchBilibiliMaterials(keywords, count);
    // Bilibili gets higher base score since it's the preferred source for Chinese content
    return results.map((r) => ({ ...r, matchScore: Math.min(1, r.matchScore + 0.2) }));
  } catch (err) {
    console.warn(`Bilibili search failed for "${keywords}":`, err instanceof Error ? err.message : err);
    return [];
  }
}

/**
 * Search for materials across multiple platforms for a scene.
 * Priority: Bilibili (Chinese content) with multi-query strategy > Pexels/Pixabay (stock footage).
 * Returns results sorted by matchScore (best first).
 */
export async function searchMaterialsForScene(
  ctx: SceneSearchContext,
  count: number = 5
): Promise<MaterialResult[]> {
  const searchQueries = buildSearchQueries(ctx);

  // Try Bilibili with prioritized queries (stop when we get results)
  for (const { query, label } of searchQueries) {
    try {
      console.log(`[search] Scene ${ctx.sceneNumber}: trying "${query}" (${label})`);
      const results = await searchBilibiliSource(query, count);
      if (results.length > 0) {
        console.log(`[search] Scene ${ctx.sceneNumber}: found ${results.length} results via "${label}"`);
        const seenUrls = new Set<string>();
        return results.filter((r) => {
          if (seenUrls.has(r.fileUrl)) return false;
          seenUrls.add(r.fileUrl);
          return true;
        }).slice(0, count);
      }
    } catch (err) {
      console.warn(`[search] Bilibili failed for "${query}" (${label}):`, err instanceof Error ? err.message : err);
    }
  }

  // Fallback: Pexels stock footage
  const keywordSets = extractSearchKeywords(ctx);
  const allResults: MaterialResult[] = [];

  for (const keywords of keywordSets) {
    try {
      const pexelsResults = await searchPexelsSource(keywords, count, ctx);
      allResults.push(...pexelsResults);
    } catch (err) {
      console.warn(`[search] Pexels failed for "${keywords}":`, err);
    }
  }

  const seenUrls = new Set<string>();
  return allResults.filter((r) => {
    if (seenUrls.has(r.fileUrl)) return false;
    seenUrls.add(r.fileUrl);
    return true;
  }).slice(0, count);
}

/**
 * Search materials for multiple scenes in parallel.
 * Returns a map of sceneNumber -> best material result.
 */
export async function searchMaterialsForScenes(
  scenes: SceneSearchContext[],
  concurrency: number = 3
): Promise<Map<number, MaterialResult>> {
  const results = new Map<number, MaterialResult>();

  for (let i = 0; i < scenes.length; i += concurrency) {
    const batch = scenes.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(
      batch.map((ctx) => searchMaterialsForScene(ctx, 3))
    );

    for (let j = 0; j < batch.length; j++) {
      const result = batchResults[j];
      if (result.status === "fulfilled" && result.value.length > 0) {
        results.set(batch[j].sceneNumber, result.value[0]);
      }
    }
  }

  return results;
}
