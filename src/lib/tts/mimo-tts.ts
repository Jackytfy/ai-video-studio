export interface MiMoTTSOptions {
  voice?: string;
  style?: string;
  apiKey?: string;
  baseUrl?: string;
}

const MIMO_VOICES = {
  "冰糖": { id: "冰糖", language: "zh", gender: "female", label: "冰糖（中文 女）" },
  "茉莉": { id: "茉莉", language: "zh", gender: "female", label: "茉莉（中文 女）" },
  "苏打": { id: "苏打", language: "zh", gender: "male", label: "苏打（中文 男）" },
  "白桦": { id: "白桦", language: "zh", gender: "male", label: "白桦（中文 男）" },
  "Mia": { id: "Mia", language: "en", gender: "female", label: "Mia (EN Female)" },
  "Chloe": { id: "Chloe", language: "en", gender: "female", label: "Chloe (EN Female)" },
  "Milo": { id: "Milo", language: "en", gender: "male", label: "Milo (EN Male)" },
  "Dean": { id: "Dean", language: "en", gender: "male", label: "Dean (EN Male)" },
};

export { MIMO_VOICES };

export async function generateMiMoTTS(
  text: string,
  options: MiMoTTSOptions = {}
): Promise<Buffer> {
  const apiKey = options.apiKey || process.env.MIMO_API_KEY;
  if (!apiKey) throw new Error("MIMO_API_KEY not configured");

  const baseUrl = options.baseUrl || "https://token-plan-cn.xiaomimimo.com/v1";
  const voice = options.voice || "冰糖";
  const style = options.style || "";

  const messages: Array<{ role: string; content: string }> = [];

  if (style) {
    messages.push({ role: "user", content: style });
  }

  messages.push({ role: "assistant", content: text });

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "mimo-v2.5-tts",
      messages,
      audio: {
        format: "wav",
        voice,
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`MiMo TTS API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();
  const audioData = data.choices?.[0]?.message?.audio?.data;
  if (!audioData) {
    throw new Error("MiMo TTS: no audio data in response");
  }

  return Buffer.from(audioData, "base64");
}
