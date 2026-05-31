import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { generateAI, buildProviderConfig } from "@/lib/ai/router";

const CHARS_PER_SECOND = 3.5;
const MIN_SCENE_CHARS = 15;

interface SceneData {
  text: string;
  title: string;
  meta?: ProductionMeta;
}

interface ProductionMeta {
  scripts: string[];
  properNouns: { name: string; type: string }[];
  era: string;
  sources: string[];
  preference: string;
}

/**
 * Extract the first sentence as a title candidate.
 */
function extractTitle(text: string): string {
  const m = text.match(/^([^。！？\n]{4,40})[。！？]?/);
  return m?.[1]?.trim() || text.slice(0, 20);
}

// ──────────────────── Paragraph fallback split ────────────────────

function paragraphSplit(rawText: string): { text: string; title: string }[] {
  const paragraphs = rawText
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, "").trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) {
    paragraphs.push(rawText);
  }

  const scenes = paragraphs.map((para) => ({
    text: para,
    title: extractTitle(para),
  }));

  const merged: { text: string; title: string }[] = [];
  for (const s of scenes) {
    if (merged.length > 0 && s.text.length < MIN_SCENE_CHARS) {
      merged[merged.length - 1].text += s.text;
    } else {
      merged.push(s);
    }
  }
  return merged;
}

// ──────────────────── AI semantic split ────────────────────

async function semanticSplit(
  rawText: string,
): Promise<SceneData[] | null> {
  try {
    const paragraphs = rawText
      .split(/\n{2,}/)
      .map((p) => p.replace(/\n/g, "").trim())
      .filter((p) => p.length > 0);

    if (paragraphs.length <= 1) return null;

    const paraList = paragraphs
      .map((p, i) => `[段落${i + 1}] ${p}`)
      .join("\n\n");

    const aiConfig = buildProviderConfig({
      aiProvider: "claude",
      aiModel: "mimo-v2.5-pro",
    });

    const prompt = `你是一个视频分镜师。以下是文案被初步拆分的 ${paragraphs.length} 个段落。
请按【语义】将语义相近的段落合并到同一个场景中。

核心规则：
1. 同一主题/观点/故事段落的相邻段落 → 合并为一个场景
2. 在语义转折、话题切换处 → 分开为不同场景
3. 场景数量控制在 2—7 个（段落多则场景多，但不要过度拆分）
4. 每个场景给一个简短标题（≤12字）

段落列表：
${paraList}

请严格返回以下 JSON（只返回 JSON，不要其他文字）：
{
  "scenes": [
    { "sceneNumber": 1, "title": "场景标题", "paragraphs": [1, 2] },
    { "sceneNumber": 2, "title": "场景标题", "paragraphs": [3, 4, 5] }
  ]
}

paragraphs 数组中的数字对应上面的段落编号。必须覆盖所有段落，不能遗漏。`;

    const result = await generateAI({
      provider: aiConfig.provider,
      model: aiConfig.model,
      baseUrl: aiConfig.baseUrl,
      apiKey: aiConfig.apiKey,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 2048,
    });

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) { console.warn("[quick-generate] AI response has no JSON, falling back"); return null; }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.scenes || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
      console.warn("[quick-generate] AI returned empty scenes, falling back"); return null;
    }

    const scenes: SceneData[] = [];
    const usedParas = new Set<number>();

    for (const s of parsed.scenes) {
      const paraNums: number[] = (s.paragraphs || [])
        .map(Number)
        .filter((n: number) => n >= 1 && n <= paragraphs.length);
      if (paraNums.length === 0) continue;

      const sceneText = paraNums.map((n: number) => paragraphs[n - 1]).join("");
      if (sceneText.length === 0) continue;
      paraNums.forEach((n: number) => usedParas.add(n));

      scenes.push({ text: sceneText, title: s.title || extractTitle(sceneText) });
    }

    if (usedParas.size < paragraphs.length) {
      console.warn(`[quick-generate] AI missed ${paragraphs.length - usedParas.size} paragraphs, falling back`);
      return null;
    }
    if (scenes.length < 2) { console.warn("[quick-generate] AI returned only 1 scene, falling back"); return null; }

    console.log(`[quick-generate] AI semantic split: ${scenes.length} scenes from ${paragraphs.length} paragraphs`);
    return scenes;
  } catch (err) {
    console.warn("[quick-generate] AI semantic split error, falling back to paragraph:", err);
    return null;
  }
}

// ──────────────────── Production detail generation ────────────────────

async function generateProductionDetails(
  scenes: SceneData[],
): Promise<void> {
  try {
    const aiConfig = buildProviderConfig({
      aiProvider: "claude",
      aiModel: "mimo-v2.5-pro",
    });

    const sceneList = scenes
      .map((s, i) => `场景${i + 1}【${s.title}】：${s.text.slice(0, 200)}`)
      .join("\n\n");

    const prompt = `你是一名专业的影视制片助理。为以下 ${scenes.length} 个分镜场景分别生成详细的制作信息。

每个场景请提供：
1. scripts: 将场景文本拆分为口播脚本行（每句一行，格式"脚本1：xxx"）
2. properNouns: 提取专名清单 [{name, type}]（type可以取：人物、地名、封号、典籍、群体、年代、事件等）
3. era: 该场景对应的国家/年代（如"中国 / 明朝洪武年间"）
4. sources: 推荐素材来源（如"《中国通史》纪录片"、"《大明宫》纪录片"）
5. preference: 素材风格偏好（场景氛围、色调、镜头风格等）
6. visualDesc: 详细的画面描述（50-100字）
7. materialQuery: 英文素材检索关键词
8. sceneType: 画面类型，取 REAL_FOOTAGE（实拍素材）或 ANIMATION（动画素材）

场景内容：
${sceneList}

请严格返回 JSON（只返回 JSON）：
{
  "scenes": [
    {
      "sceneNumber": 1,
      "scripts": ["脚本1：xxx", "脚本2：xxx"],
      "properNouns": [{"name": "朱棣", "type": "人物"}],
      "era": "中国 / 明朝洪武年间",
      "sources": ["《中国通史》纪录片"],
      "preference": "北疆战场场景，色调偏冷峻，突出肃杀之气",
      "visualDesc": "详细的画面描述...",
      "materialQuery": "ming dynasty northern frontier battlefield",
      "sceneType": "REAL_FOOTAGE"
    }
  ]
}`;

    const result = await generateAI({
      provider: aiConfig.provider,
      model: aiConfig.model,
      baseUrl: aiConfig.baseUrl,
      apiKey: aiConfig.apiKey,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 4096,
    });

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) { console.warn("[quick-generate] Production details: no JSON in response"); return; }

    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.scenes || !Array.isArray(parsed.scenes)) return;

    for (const detail of parsed.scenes) {
      const idx = (detail.sceneNumber || 1) - 1;
      if (idx < 0 || idx >= scenes.length) continue;

      scenes[idx].meta = {
        scripts: detail.scripts || [],
        properNouns: detail.properNouns || [],
        era: detail.era || "",
        sources: detail.sources || [],
        preference: detail.preference || "",
      };
    }
    console.log(`[quick-generate] Production details generated for ${parsed.scenes.length} scenes`);
  } catch (err) {
    console.warn("[quick-generate] Production detail generation failed:", err);
  }
}

// ──────────────────── Main handler ────────────────────

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    if (!session) return unauthorized();

    const { id } = await params;
    const project = await prisma.project.findFirst({
      where: { id, userId: session.user.id },
    });

    if (!project) {
      return NextResponse.json({ error: "项目不存在" }, { status: 404 });
    }

    await prisma.project.update({
      where: { id },
      data: { status: "STORYBOARD_GENERATING" },
    });

    const rawText = project.sourceText;
    const style = project.contentStyle;

    // ----- Step 1: AI semantic split -----
    let scenes: SceneData[] | null = await semanticSplit(rawText);
    let usedSemantic = scenes !== null && scenes.length > 0;

    if (!scenes || scenes.length === 0) {
      console.log("[quick-generate] Using paragraph-based split");
      scenes = (paragraphSplit(rawText) as { text: string; title: string }[]).map(s => ({ text: s.text, title: s.title }));
      usedSemantic = false;
    }

    // ----- Step 2: Generate production details (scripts, properNouns, era, etc.) -----
    await generateProductionDetails(scenes);

    const totalChars = scenes.reduce((sum, s) => sum + s.text.length, 0);
    const totalDuration = Math.round(totalChars / CHARS_PER_SECOND);

    const storyboard = await prisma.storyboard.create({
      data: {
        projectId: id,
        status: "CONFIRMED",
        totalScenes: scenes.length,
        totalDuration,
        scenes: {
          create: scenes.map((s, i) => ({
            sceneNumber: i + 1,
            title: s.title,
            voiceoverText: s.text,
            visualDesc: s.meta?.scripts?.join("；") || s.text.slice(0, 80),
            materialQuery: s.meta?.preference || s.text.replace(/[，。！？、]/g, " ").slice(0, 60),
            productionMeta: s.meta ? JSON.stringify(s.meta) : null,
            wordCount: s.text.length,
            estimatedDuration: Math.round(s.text.length / CHARS_PER_SECOND),
            sceneType: (s.meta?.preference?.includes("动画") ? "ANIMATION" : "REAL_FOOTAGE") as any,
          })),
        },
      },
      include: { scenes: { orderBy: { sceneNumber: "asc" } } },
    });

    await prisma.project.update({
      where: { id },
      data: {
        status: "STORYBOARD_READY",
        aiAnalysis: JSON.stringify({
          summary: rawText.slice(0, 50),
          sceneCount: scenes.length,
          estimatedDuration: totalDuration,
          splitMethod: usedSemantic ? "semantic" : "paragraph",
        }),
      },
    });

    return NextResponse.json({ storyboard });
  } catch (error) {
    console.error("Quick generate failed:", error);
    await prisma.project
      .update({ where: { id: (await params).id }, data: { status: "FAILED" } })
      .catch(() => {});
    return NextResponse.json({ error: "生成失败" }, { status: 500 });
  }
}
