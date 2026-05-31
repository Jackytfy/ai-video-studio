/**
 * Test Bilibili search directly
 */
async function main() {
  const query = "北疆 战场";
  console.log("Search Bilibili:", query);
  
  const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(query)}&page=1&page_size=3`;
  console.log("URL:", url);
  
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": "https://search.bilibili.com/",
      "Origin": "https://search.bilibili.com",
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(10000),
  });
  
  console.log("Status:", res.status);
  const data = await res.json();
  console.log("Code:", data.code);
  console.log("Message:", data.message);
  console.log("Results:", data.data?.result?.length || 0);
  
  if (data.data?.result) {
    data.data.result.slice(0, 3).forEach(v => {
      const title = v.title.replace(/<[^>]*>/g, "");
      console.log(`  - [${v.duration}] ${title.slice(0, 60)}`);
    });
  }
  
  // Also test stream URL retrieval
  if (data.data?.result?.length > 0) {
    const bvid = data.data.result[0].bvid;
    console.log("\nTest stream for bvid:", bvid);
    
    const infoRes = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, {
      headers: { "User-Agent": "Mozilla/5.0", Referer: "https://www.bilibili.com/" },
      signal: AbortSignal.timeout(10000),
    });
    const info = await infoRes.json();
    console.log("View code:", info.code, "cid:", info.data?.cid);
    
    if (info.data?.cid) {
      const streamRes = await fetch(
        `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${info.data.cid}&qn=80&fnval=1`,
        {
          headers: { "User-Agent": "Mozilla/5.0", Referer: `https://www.bilibili.com/video/${bvid}` },
          signal: AbortSignal.timeout(10000),
        }
      );
      const streamData = await streamRes.json();
      console.log("Stream code:", streamData.code);
      console.log("DURL count:", streamData.data?.durl?.length || 0);
      if (streamData.data?.durl?.length > 0) {
        console.log("Video URL:", streamData.data.durl[0].url?.slice(0, 80));
      }
    }
  }
}

main().catch(e => console.error(e));
