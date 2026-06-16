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
  title?: string;
  description?: string;
}

export interface SceneSearchContext {
  sceneNumber: number;
  materialQuery: string;
  materialQueryEn?: string;
  visualDesc?: string;
  sourceVideos?: string[];
}

/**
 * Extract concrete keywords from visualDesc for Bilibili search.
 * Filters out non-searchable terms. Returns up to 10 keywords.
 * Exported for use by confirm route re-ranking.
 */
export function extractVisualDescKeywords(text: string): string[] {
  if (!text) return [];
  const nonSearchable = new Set([
    "画面", "描述", "展现", "展示", "呈现", "表现", "体现", "反映",
    "风格", "色调", "氛围", "镜头", "光影", "构图", "采用", "运用",
    "使用", "适合", "需要", "可以", "强烈", "突出", "营造",
    "例如", "视频", "片段", "该部", "这部", "中的", "聚焦", "注重",
    "整体", "相关", "经典", "缓缓", "慢慢", "快速", "逐渐",
    "最终", "开始", "结束", "显示", "映照", "笼罩", "充满", "转为",
    "变为", "化为", "定格", "切换", "这是", "那是", "他的", "她的",
    "我的", "这个", "那个", "这些", "那些", "最后", "首先", "然后",
    "接着", "同时", "此时", "近景", "远景", "全景", "特写",
  ]);

  const keywords: string[] = [];
  const seen = new Set<string>();
  const usedChars = new Set<number>(); // track character positions used by Pass 1

  // Pass 1: Segment by punctuation, extract 4-8 char content phrases
  const phrases = text.split(/[，,。；;！!？?、：:\s]+/).filter(p => p.length >= 4);
  for (const phrase of phrases) {
    const segments = phrase.match(/[一-鿿]{4,8}/g) || [];
    for (const seg of segments) {
      if (nonSearchable.has(seg) || seen.has(seg)) continue;
      keywords.push(seg);
      seen.add(seg);
      // Mark character positions as used
      const idx = text.indexOf(seg);
      if (idx >= 0) {
        for (let i = idx; i < idx + seg.length; i++) usedChars.add(i);
      }
      if (keywords.length >= 10) break;
    }
    if (keywords.length >= 10) break;
  }

  // Pass 2: 2-3 char keywords from uncovered positions only
  if (keywords.length < 10) {
    const shortWords = text.match(/[一-鿿]{2,3}/g) || [];
    for (const w of shortWords) {
      if (seen.has(w)) continue;
      if (nonSearchable.has(w)) continue;
      if (/^[一二三四五六七八九十百千万亿]+$/.test(w)) continue;
      if (/[在的了着过和与及把被从向往]$/.test(w)) continue;
      // Skip if all characters already covered by Pass 1
      const idx = text.indexOf(w);
      if (idx >= 0) {
        const covered = Array.from({ length: w.length }, (_, i) => usedChars.has(idx + i)).every(Boolean);
        if (covered) continue;
      }
      keywords.push(w);
      seen.add(w);
      if (keywords.length >= 10) break;
    }
  }

  return keywords;
}

/**
 * Build prioritized search queries for a scene.
 * Returns an array of {query, label} sorted by priority (most precise first).
 *
 * Strategy: visualDesc is primary search guide. sourceVideos provide
 * exact show/documentary names. materialQuery is fallback keywords.
 */
function buildSearchQueries(ctx: SceneSearchContext): { query: string; label: string }[] {
  const queries: { query: string; label: string }[] = [];
  const sourceVideos = ctx.sourceVideos || [];
  const materialKeywords = ctx.materialQuery || "";
  const visualKeywords = extractVisualDescKeywords(ctx.visualDesc || "");
  const added = new Set<string>(); // dedupe queries

  const addQuery = (query: string, label: string) => {
    const key = query.trim().toLowerCase();
    if (key.length < 2 || added.has(key)) return;
    added.add(key);
    queries.push({ query: query.trim(), label });
  };

  // --- Phase 1: sourceVideos + visual keywords (MOST PRECISE) ---
  // Use ALL sourceVideos, not just the first one.
  // Each sourceVideo combined with visual keywords = separate query.
  for (const sv of sourceVideos.slice(0, 3)) {
    if (visualKeywords.length > 0) {
      addQuery(
        `${sv} ${visualKeywords.slice(0, 4).join(" ")}`,
        "来源+画面关键词"
      );
    }
  }

  // --- Phase 2: sourceVideos + materialQuery ---
  for (const sv of sourceVideos.slice(0, 2)) {
    if (materialKeywords) {
      addQuery(`${sv} ${materialKeywords}`, "来源+检索词");
    }
  }

  // --- Phase 3: sourceVideos alone (as separate queries) ---
  for (const sv of sourceVideos.slice(0, 3)) {
    addQuery(sv, "来源");
  }

  // --- Phase 4: visualDesc keywords as main query ---
  if (visualKeywords.length > 0) {
    addQuery(visualKeywords.join(" "), "画面关键词");
  }

  // --- Phase 5: materialQueryEn + visual keywords (English + Chinese hybrid) ---
  if (ctx.materialQueryEn && visualKeywords.length > 0) {
    addQuery(
      `${ctx.materialQueryEn} ${visualKeywords.slice(0, 2).join(" ")}`,
      "英文检索词+画面关键词"
    );
  }

  // --- Phase 6: materialQuery alone (fallback) ---
  if (materialKeywords) {
    addQuery(materialKeywords, "检索词");
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
 * Score a material result based on resolution, duration, AND semantic relevance.
 * Semantic relevance (visualDesc keyword match) is the dominant factor.
 */
function scoreMaterial(
  material: { width: number; height: number; duration?: number; title?: string; description?: string; searchQuery?: string },
  ctx: SceneSearchContext
): number {
  let score = 0.3; // Lower base — most points earned through relevance

  // Resolution bonus (max 0.15)
  if (material.width >= 1920 || material.height >= 1080) score += 0.15;
  else if (material.width >= 1280 || material.height >= 720) score += 0.08;

  // Duration bonus (max 0.15)
  if (material.duration) {
    if (material.duration >= 5 && material.duration <= 30) score += 0.15;
    else if (material.duration >= 3 && material.duration <= 60) score += 0.08;
  }

  // Semantic relevance bonus (max 0.55) — THE KEY ADDITION
  if (ctx.visualDesc) {
    const visKeywords = extractVisualDescKeywords(ctx.visualDesc);
    const searchText = ((material.title || "") + " " + (material.description || "") + " " + (material.searchQuery || "")).replace(/[\s　、。，；《》「」『』“”‘’【】]/g, "");

    let matchedCount = 0;
    for (const kw of visKeywords) {
      if (searchText.includes(kw)) matchedCount++;
    }
    const keywordCoverage = visKeywords.length > 0 ? matchedCount / visKeywords.length : 0;
    // Keyword coverage maps to 0-0.4
    score += Math.min(keywordCoverage * 0.8, 0.4);

    // Bonus: materialQuery exact match (the AI's curated search term)
    const mqClean = (ctx.materialQuery || "").replace(/[\s,，、]+/g, "");
    if (mqClean && searchText.includes(mqClean)) {
      score += 0.15;
    }
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
        matchScore: scoreMaterial({ width: bestFile.width, height: bestFile.height, duration: video.duration, description: keywords, searchQuery: keywords }, ctx),
        searchQuery: keywords,
        platform: "pexels",
        description: keywords,
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
        matchScore: scoreMaterial({ width: img.width, height: img.height, description: keywords, searchQuery: keywords }, ctx) * 0.8,
        searchQuery: keywords,
        platform: "pexels",
        description: keywords,
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
        matchScore: scoreMaterial({ width: bestFile.width, height: bestFile.height, duration: video.duration, description: video.tags, searchQuery: keywords }, ctx),
        searchQuery: keywords,
        platform: "pixabay",
        description: video.tags,
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
        matchScore: scoreMaterial({ width: img.imageWidth, height: img.imageHeight, description: img.tags, searchQuery: keywords }, ctx) * 0.8,
        searchQuery: keywords,
        platform: "pixabay",
        description: img.tags,
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
 * Negative keywords: block non-drama/documentary content from Bilibili results.
 * Shared list for both search-engine and render pipeline.
 */
const BILIBILI_NEGATIVE_KEYWORDS = [
  // User-generated / fan content
  "混剪", "踩点", "二创", "reaction", "Reaction",
  "吐槽", "影评", "观后感", "观后", "推荐", "安利",
  "UP主", "博主", "up主", "整活", "恶搞", "鬼畜",
  "弹幕", "翻唱", "cos", "Cos", "COS",
  "测评", "评测", "开箱", "拆包",
  // Short dramas / romance (low quality)
  "短剧", "言情", "大女主", "重生", "穿越", "甜宠",
  "霸总", "逆袭", "爽剧", "微短剧", "竖屏短剧",
  // Lifestyle / entertainment
  "试吃", "吃播", "美食", "做饭", "探店",
  "比亚迪", "汽车", "手机", "直播", "带货",
  "搞笑", "段子", "相亲", "综艺",
  // Games (block all game-related content)
  "游戏", "我的世界", "Minecraft", "minecraft",
  "王者荣耀", "原神", "和平精英", "英雄联盟", "LOL",
  "绝地求生", "PUBG", "pubg", "三国杀", "率土之滨",
  "真三国无双", "全面战争", "三国志战略版",
  "三国群英传", "文明", "Red Alert", "魔兽",
  "永劫无间", "崩坏", "鸣潮", "第五人格",
  "实况", "主播", "攻略",
  // Toys / models
  "乐高", "积木", "手办", "模型",
  // School courses
  "中小学", "初中", "高中", "小学", "课时",
  "文言文", "语文", "数学", "英语", "考试",
  "习题", "考点",
  // Anime / 2D (not real footage)
  "动漫", "动画", "番剧", "二次元", "国漫",
  // Other
  "VLOG", "vlog", "日常", "记录",
];

/**
 * Filter out Bilibili results that contain negative keywords in title.
 * Returns only results whose title does NOT match any negative keyword.
 */
function filterNegativeKeywords(results: MaterialResult[]): MaterialResult[] {
  return results.filter(r => {
    const title = (r.title || "").toLowerCase();
    const isNegative = BILIBILI_NEGATIVE_KEYWORDS.some(nk => title.includes(nk.toLowerCase()));
    if (isNegative) {
      console.log(`[search] filtered out: "${(r.title || "").slice(0, 40)}" (negative keyword)`);
    }
    return !isNegative;
  });
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
    // Filter out gaming, fan-made, and other non-official content
    const filtered = filterNegativeKeywords(results);
    // Bilibili gets higher base score since it's the preferred source for Chinese content
    return filtered.map((r) => ({ ...r, matchScore: Math.min(1, r.matchScore + 0.2) }));
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
