/**
 * Bilibili video search and download.
 *
 * Uses Bilibili's web search API to find videos.
 * Downloads video clips via Bilibili's video stream API.
 * All content is watermarked — watermark removal handled by caller.
 */

export interface BilibiliVideo {
  bvid: string;
  aid: number;
  title: string;
  description: string;
  pic: string; // thumbnail URL
  duration: string; // "MM:SS" format
  author: string;
  play: number; // view count
  videoUrl?: string;
}

/**
 * Parse "MM:SS" or "HH:MM:SS" duration string to seconds.
 */
function parseDuration(dur: string): number {
  const parts = dur.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/**
 * Negative keywords: block non-drama/documentary content at the Bilibili search source.
 * Every caller of searchBilibiliVideos is automatically protected.
 */
const NEGATIVE_KEYWORDS = [
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
  // Games — comprehensive list
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
 * Filter Bilibili results by negative keywords in title.
 * Request extra results from API to compensate for filtered-out items.
 */
function filterByNegativeKeywords<T extends { title: string }>(
  items: T[],
  requestedCount: number
): T[] {
  const filtered = items.filter(item => {
    const titleLower = item.title.toLowerCase();
    return !NEGATIVE_KEYWORDS.some(nk => titleLower.includes(nk.toLowerCase()));
  });
  return filtered.slice(0, requestedCount);
}

/**
 * Search Bilibili for videos matching a query.
 * Returns video metadata (no download URLs — use getVideoStream for that).
 * Automatically filters out gaming, fan-made, and other non-official content.
 *
 * Supports retry with exponential backoff and handles Bilibili rate-limit
 * responses (HTML instead of JSON) gracefully.
 */
export async function searchBilibiliVideos(
  query: string,
  count: number = 5
): Promise<BilibiliVideo[]> {
  if (!query) return [];

  // Request extra results to compensate for negative keyword filtering
  const fetchCount = count * 3;

  for (let attempt = 0; attempt <= 1; attempt++) {
    try {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 800 + Math.random() * 1000));
      }

      const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(query)}&page=1&page_size=${fetchCount}&order=totalrank`;

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

        const results = (data.data?.result || []);

        const mapped = results.map((item: any) => ({
          bvid: item.bvid,
          aid: item.aid,
          title: stripHtml(item.title),
          description: item.description || "",
          pic: item.pic?.startsWith("//") ? `https:${item.pic}` : item.pic,
          duration: item.duration || "0:00",
          author: item.author || "",
          play: item.play || 0,
        }));

        // Filter out gaming, fan-made, and other non-official content at source
        return filterByNegativeKeywords(mapped, count);
      } catch {
        // Bilibili rate-limited — returned HTML instead of JSON, retry
        if (text.startsWith("<")) continue;
        return [];
      }
    } catch {
      continue;
    }
  }

  return [];
}

/**
 * Get video stream URL for a Bilibili video.
 * Returns the best available video stream URL.
 */
export async function getBilibiliVideoStream(bvid: string): Promise<string | null> {
  try {
    // First get video info to find cid
    const infoUrl = `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`;
    const infoRes = await fetch(infoUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://www.bilibili.com/",
        "Origin": "https://www.bilibili.com",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!infoRes.ok) return null;
    const infoData = await infoRes.json();
    if (infoData.code !== 0) return null;

    const cid = infoData.data?.cid;
    if (!cid) return null;

    // Get video stream URL
    const streamUrl = `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=1`;
    const streamRes = await fetch(streamUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": `https://www.bilibili.com/video/${bvid}`,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!streamRes.ok) return null;
    const streamData = await streamRes.json();
    if (streamData.code !== 0) return null;

    // Return the first video URL
    const durl = streamData.data?.durl;
    if (durl && durl.length > 0) {
      return durl[0].url;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Search Bilibili and return results in MaterialResult format.
 */
export async function searchBilibiliMaterials(
  query: string,
  count: number = 3
): Promise<Array<{
  externalId: string;
  type: "VIDEO";
  source: "STOCK_FOOTAGE";
  fileUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  duration: number;
  matchScore: number;
  searchQuery: string;
  platform: "bilibili";
  needsWatermarkRemoval: true;
  title: string;
  description: string;
}>> {
  const videos = await searchBilibiliVideos(query, count);
  const results = [];

  for (const video of videos) {
    const durationSec = parseDuration(video.duration);
    // Skip very short (< 3s) or very long (> 300s) videos
    if (durationSec < 3 || durationSec > 300) continue;

    // Try to get direct stream URL
    const streamUrl = await getBilibiliVideoStream(video.bvid);

    // Skip if no direct stream URL — page URL won't work for FFmpeg download
    if (!streamUrl) continue;

    results.push({
      externalId: `bilibili-${video.bvid}`,
      type: "VIDEO" as const,
      source: "STOCK_FOOTAGE" as const,
      fileUrl: streamUrl,
      thumbnailUrl: video.pic,
      width: 1920, // Bilibili HD is typically 1920x1080
      height: 1080,
      duration: durationSec,
      matchScore: 0.6, // Lower score than stock footage (copyright risk)
      searchQuery: query,
      platform: "bilibili" as const,
      needsWatermarkRemoval: true as const,
      title: stripHtml(video.title),
      description: stripHtml(video.description),
    });
  }

  return results;
}

/**
 * Strip HTML tags from Bilibili search results (they use <em> tags).
 */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}
