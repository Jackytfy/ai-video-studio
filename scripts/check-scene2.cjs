const BASE = "http://localhost:3000";
const PID = "cmptcds8c000fqgulp7llz5qj";

async function main() {
  const sb = await fetch(`${BASE}/api/projects/${PID}/storyboard`).then(r => r.json());
  const s2 = sb.scenes[1];
  console.log("Scene 2 title:", s2.title);
  console.log("voiceoverText length:", s2.voiceoverText.length);
  console.log("voiceoverText:", s2.voiceoverText);
  
  // Check for problematic chars
  const hasDoubleQuotes = /"/.test(s2.voiceoverText);
  const hasDashes = /——/.test(s2.voiceoverText);
  console.log("Has double quotes:", hasDoubleQuotes);
  console.log("Has dashes:", hasDashes);
  
  // Show unique non-ASCII chars
  const chars = [...new Set(s2.voiceoverText)].filter(c => c.charCodeAt(0) > 127);
  console.log("Non-ASCII chars:", chars.join(""));
}
main();
