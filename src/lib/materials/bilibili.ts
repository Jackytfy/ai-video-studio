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
 * Search Bilibili for videos matching a query.
 * Returns video metadata (no download URLs — use getVideoStream for that).
 */
export async function searchBilibiliVideos(
  query: string,
  count: number = 5
): Promise<BilibiliVideo[]> {
  const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(query)}&page=1&page_size=${count}&order=totalrank`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Referer": "https://search.bilibili.com/",
      "Origin": "https://search.bilibili.com",
      "Accept": "application/json",
      "Cookie": "buvid3=placeholder",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) throw new Error(`Bilibili search HTTP ${res.status}`);

  const data = await res.json();
  if (data.code !== 0) throw new Error(`Bilibili API error: ${data.message}`);

  const results = (data.data?.result || []).slice(0, count);

  return results.map((item: any) => ({
    bvid: item.bvid,
    aid: item.aid,
    title: stripHtml(item.title),
    description: item.description || "",
    pic: item.pic?.startsWith("//") ? `https:${item.pic}` : item.pic,
    duration: item.duration || "0:00",
    author: item.author || "",
    play: item.play || 0,
  }));
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
