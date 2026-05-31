/**
 * Debug material search engine
 */
async function main() {
  // Get scene from the latest project
  const BASE = "http://localhost:3000";
  const pid = "cmptgef9u0000b8ulvyqbikks";
  
  const sbRes = await fetch(`${BASE}/api/projects/${pid}/storyboard`);
  const sb = await sbRes.json();
  
  const scene = sb.scenes[0];
  console.log("Scene 1:", scene.title);
  console.log("materialQuery:", scene.materialQuery);
  
  // Manually test the search logic
  const query = scene.materialQuery;
  
  // Step 1: Extract Chinese keywords
  const chineseParts = query.split(/[,，、\s]+/).filter(p => p.length >= 2);
  const chineseQuery = chineseParts.length >= 2 
    ? chineseParts.slice(0, 3).join(" ") 
    : query.substring(0, 20);
  console.log("Chinese query:", chineseQuery);
  
  // Step 2: Extract English keywords via conceptMap
  const searchText = query + " " + (scene.visualDesc || "");
  const conceptMap = {
    "战场": "battlefield war", "北疆": "northern frontier desert",
    "冷峻": "cold dramatic", "肃杀": "dramatic intense",
    "军事": "military army", "古代": "ancient historical",
    "史诗": "epic cinematic", "氛围": "atmosphere moody",
  };
  
  const matchedKeywords = [];
  for (const [cn, en] of Object.entries(conceptMap)) {
    if (searchText.includes(cn)) {
      matchedKeywords.push(en);
    }
  }
  const englishQuery = matchedKeywords.slice(0, 4).join(" ");
  console.log("English query:", englishQuery);
  
  // Step 3: Test Bilibili
  console.log("\nTesting Bilibili...");
  try {
    const bUrl = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(chineseQuery)}&page=1&page_size=3`;
    const bRes = await fetch(bUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Referer": "https://search.bilibili.com/",
        "Origin": "https://search.bilibili.com",
        "Accept": "application/json",
      },
      signal: AbortSignal.timeout(10000),
    });
    const bData = await bRes.json();
    console.log("  Bilibili code:", bData.code, "message:", bData.message);
    console.log("  Results:", bData.data?.result?.length || 0);
  } catch(e) {
    console.log("  Bilibili error:", e.message);
  }
  
  // Step 4: Test Pexels
  console.log("\nTesting Pexels with:", englishQuery);
  try {
    const k = "qTcCNlqFVXIzEPRobyWXD9eY9CPb8xuTaWhsmywDIFrHtzUtMh6nonTF";
    const pRes = await fetch(`https://api.pexels.com/videos/search?query=${encodeURIComponent(englishQuery)}&per_page=3`, {
      headers: { Authorization: k },
    });
    const pData = await pRes.json();
    console.log("  Pexels status:", pRes.status);
    console.log("  Videos:", pData.videos?.length || 0, "Total:", pData.total_results || 0);
    if (pData.videos?.length > 0) {
      console.log("  First video:", pData.videos[0].url?.slice(0, 60));
    }
  } catch(e) {
    console.log("  Pexels error:", e.message);
  }
}

main().catch(e => console.error(e));
