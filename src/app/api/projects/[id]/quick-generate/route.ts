import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { generateAI, buildProviderConfig } from "@/lib/ai/router";

const CHARS_PER_SECOND = 3.5;

interface SceneData {
  sceneNumber: number;
  title: string;
  sceneType: string;
  voiceoverText: string;
  visualDesc: string;
  materialQuery: string;
  materialQueryEn: string;
  sourceVideos: string[];
  scripts: string[];
  wordCount: number;
  estimatedDuration: number;
}

/**
 * Generate detailed storyboard in one AI call using the same prompt as storyboard/generate.
 * Auto-calculates scene count based on text length.
 */
async function generateDetailedStoryboard(
  rawText: string,
  plan: "A" | "B",
  materialRequirements?: {
    contentSummary?: string;
    referenceStyle?: string;
    requiredSources?: string[];
    preferredSources?: string[];
    materialTypes?: string[];
    properNouns?: string[];
    landmarkScenes?: string[];
    stylePreference?: string;
    timeLimit?: string;
    regionLimit?: string;
    avoidKeywords?: string[];
  } | null,
): Promise<SceneData[]> {
  const chineseChars = (rawText.match(/[\u4e00-\u9fff]/g) || []).length;
  const sceneCount = Math.max(5, Math.min(30, Math.round(chineseChars / 70)));
  const wordsPerScene = Math.max(40, Math.min(80, Math.round(chineseChars / sceneCount)));

  const planDescription =
    plan === "A"
      ? "素材剪辑成片：使用实拍素材（历史影像、纪录片片段、实景拍摄）进行剪辑"
      : "素材+MG动画：混合使用实拍素材和MG动画（图形动画、数据可视化、概念动画）";

  // Build material requirements section for prompt
  let materialReqSection = "";
  if (materialRequirements) {
    const parts: string[] = [];
    if (materialRequirements.contentSummary) {
      parts.push(`**内容摘要**：${materialRequirements.contentSummary}。分镜时需围绕此核心主题展开`);
    }
    if (materialRequirements.referenceStyle) {
      parts.push(`**参考风格**：${materialRequirements.referenceStyle}。分镜节奏和画面选择需参考此风格`);
    }
    if (materialRequirements.requiredSources?.length) {
      parts.push(`**必须使用的素材来源**：${materialRequirements.requiredSources.join("、")}。这些影视作品的画面必须在视频中出现，sourceVideos必须优先从这些作品中选择`);
    }
    if (materialRequirements.preferredSources?.length) {
      parts.push(`**推荐素材来源**：${materialRequirements.preferredSources.join("、")}。优先从这些作品中选取素材`);
    }
    if (materialRequirements.materialTypes?.length) {
      parts.push(`**素材类型优先级**（从高到低）：${materialRequirements.materialTypes.join(" > ")}。优先使用排在前面的素材类型`);
    }
    if (materialRequirements.properNouns?.length) {
      parts.push(`**必须出现的人物/地名**：${materialRequirements.properNouns.join("、")}。必须为这些人物/地名安排专门场景，sourceVideos必须包含含有这些人物的影视作品`);
    }
    if (materialRequirements.landmarkScenes?.length) {
      parts.push(`**标志性场景**：${materialRequirements.landmarkScenes.join("、")}。需要安排专门场景展示这些标志性画面`);
    }
    if (materialRequirements.stylePreference) {
      parts.push(`**画面风格偏好**：${materialRequirements.stylePreference}`);
    }
    if (materialRequirements.timeLimit) {
      parts.push(`**时效性要求**：${materialRequirements.timeLimit}`);
    }
    if (materialRequirements.regionLimit) {
      parts.push(`**地域限定**：${materialRequirements.regionLimit}`);
    }
    if (materialRequirements.avoidKeywords?.length) {
      parts.push(`**避免出现的素材**：${materialRequirements.avoidKeywords.join("、")}`);
    }
    if (parts.length > 0) {
      materialReqSection = `\n## 素材需求（用户指定，必须严格遵守）\n${parts.join("\n")}\n`;
    }
  }

  const prompt = `你是一个专业的视频分镜师。请根据以下文稿和制作方案，生成详细的分镜脚本。

## 文稿内容
${rawText}
${materialReqSection}

## 制作方案
${planDescription}

## 分镜要求
请将文稿拆分为${sceneCount}个场景（根据内容需要可适当增减±3个，但不得少于${sceneCount - 3}个）。
文稿约${chineseChars}字，每个场景的口播文案控制在${wordsPerScene}字左右（40-100字），宁可多拆也不要把太多内容塞进一个场景。
关键原则：**一个画面 = 一个场景**，画面内容发生变化就必须拆为新场景。

每个场景包含以下字段：

1. **场景标题** (title): 简短描述场景主题（5-10字）
2. **画面类型** (sceneType): REAL_FOOTAGE（实拍素材）或 ANIMATION（动画素材）
3. **口播脚本** (voiceoverText): 该场景的完整配音文案，自然流畅的口语化表达，${wordsPerScene}字左右（40-100字）
4. **画面描述** (visualDesc): 只描述观众在屏幕上看到的画面内容。必须包含以下要素：
   - 人物：外观、服饰、动作、表情（如"身穿金色铠甲的将军"）
   - 场景：建筑、环境、天气、光影（如"阴云密布的城墙之上"）
   - 镜头：景别和运动（如"从大全景缓缓推近至面部特写"）
   - 至少50字，必须具体到可以在影视作品中找到对应片段的程度
   - ❌"古代战争场面，气氛紧张" → ✅"金色铠甲武士骑马立于古城墙上，城下旌旗密布、千军万马列阵。镜头从大全景缓缓推近至武士面部特写，逆光剪影，天空阴云密布"
5. **素材检索词** (materialQuery): 用于在Bilibili等视频平台搜索素材的关键词，必须是简洁的搜索词组。格式："核心画面内容 + 时代/风格"，控制在15字以内。例如："明朝朝堂议事 电视剧片段"、"古代战场骑兵冲锋"、"紫禁城太和殿 空镜"。禁止写成描述性段落
6. **口播分段** (scripts): 将口播脚本按语义拆分为2-4个自然段落，每段15-40字。这是字幕显示的依据，必须与voiceoverText完全一致（scripts拼接后必须等于voiceoverText），用于分段展示字幕
7. **英文检索词** (materialQueryEn): materialQuery对应的英文关键词，用于Pexels搜索，2-4个具体英文单词。例如："ancient battle cavalry charge"、"forbidden city aerial"
8. **素材来源** (sourceVideos): 推荐1-3个具体的电视剧、电影或纪录片名称，作为Bilibili素材搜索的优先来源。必须选择画面质量高、与场景内容高度匹配的影视作品。优先选择知名历史剧、纪录片。例如：["大明王朝1566", "大明风华"]、["河西走廊"]、["觉醒年代"]、["大秦帝国"]、["三国演义"]、["贞观之治"]、["走向共和"]。禁止返回空数组[]——每个场景都应推荐至少1个影视来源

## 关键规则
- **口播分段(scripts)必须与voiceoverText严格一致**：scripts数组中所有段落拼接后必须等于voiceoverText，不能多字少字或改写。这是字幕同步的核心！
- **画面描述只写观众看到的画面**（人物外貌、场景、光影、镜头运动），不要包含任何旁白/口播/解说文字
- **画面与素材一致性**：sourceVideos推荐的影视作品必须在Bilibili上真实可搜到，且其中确实包含visualDesc描述的画面内容
- **一个画面一个场景**：如果口播内容跨越多个不同画面，必须拆分为多个场景
- 场景之间要有逻辑连贯性
- 优先使用实拍素材，动画仅用于抽象概念解释

## 输出格式
请严格按以下JSON格式输出：
{
  "title": "视频标题",
  "scenes": [
    {
      "sceneNumber": 1,
      "title": "场景标题",
      "sceneType": "REAL_FOOTAGE",
      "voiceoverText": "完整的口播文案，自然连贯...",
      "visualDesc": "详细的画面描述，包含人物、环境、镜头运动、光影效果，至少50字...",
      "materialQuery": "中文素材检索条件，15字以内",
      "materialQueryEn": "english keywords for stock footage search",
      "sourceVideos": ["推荐的影视来源1", "推荐的影视来源2"],
      "scripts": ["口播分段1", "口播分段2", "口播分段3"]
    }
  ],
  "totalWords": 1200,
  "estimatedDuration": 180
}`;

  const aiConfig = buildProviderConfig({
    aiProvider: "claude",
    aiModel: "mimo-v2.5-pro",
  });

  const result = await generateAI({
    provider: aiConfig.provider,
    model: aiConfig.model,
    baseUrl: aiConfig.baseUrl,
    apiKey: aiConfig.apiKey,
    messages: [{ role: "user", content: prompt }],
    maxTokens: 8192,
  });

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI response has no JSON");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e: any) {
    throw new Error(`Failed to parse AI JSON response: ${e.message}`);
  }
  if (!parsed.scenes || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
    throw new Error("AI returned empty scenes");
  }

  console.log(`[quick-generate] AI generated ${parsed.scenes.length} scenes (target: ${sceneCount})`);

  return parsed.scenes.map((s: any) => ({
    sceneNumber: s.sceneNumber || 1,
    title: s.title || "",
    sceneType: s.sceneType || "REAL_FOOTAGE",
    voiceoverText: s.voiceoverText || "",
    visualDesc: s.visualDesc || "",
    materialQuery: s.materialQuery || "",
    materialQueryEn: s.materialQueryEn || "",
    sourceVideos: s.sourceVideos || [],
    scripts: s.scripts || [],
    wordCount: (s.voiceoverText || "").length,
    estimatedDuration: Math.round((s.voiceoverText || "").length / CHARS_PER_SECOND),
  }));
}

/**
 * Fallback: split text into scenes by paragraphs when AI fails.
 * Still generates reasonable scene structure.
 */
function fallbackSplit(rawText: string): SceneData[] {
  const paragraphs = rawText
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, "").trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) {
    paragraphs.push(rawText);
  }

  // Merge short paragraphs (< 40 chars) with previous
  const merged: string[] = [];
  for (const p of paragraphs) {
    if (merged.length > 0 && p.length < 40) {
      merged[merged.length - 1] += p;
    } else {
      merged.push(p);
    }
  }

  // Further split long paragraphs (> 150 chars) by sentences
  const scenes: SceneData[] = [];
  let sceneNum = 1;
  for (const para of merged) {
    if (para.length > 150) {
      // Split by sentence boundaries
      const sentences = para.match(/[^。！？]+[。！？]?/g) || [para];
      let currentText = "";
      for (const sent of sentences) {
        currentText += sent;
        if (currentText.length >= 60) {
          scenes.push({
            sceneNumber: sceneNum++,
            title: currentText.slice(0, 10),
            sceneType: "REAL_FOOTAGE",
            voiceoverText: currentText.trim(),
            visualDesc: currentText.slice(0, 80),
            materialQuery: currentText.replace(/[，。！？、]/g, " ").slice(0, 30),
            materialQueryEn: "",
            sourceVideos: [],
            scripts: [currentText.trim()],
            wordCount: currentText.trim().length,
            estimatedDuration: Math.round(currentText.trim().length / CHARS_PER_SECOND),
          });
          currentText = "";
        }
      }
      if (currentText.trim()) {
        scenes.push({
          sceneNumber: sceneNum++,
          title: currentText.slice(0, 10),
          sceneType: "REAL_FOOTAGE",
          voiceoverText: currentText.trim(),
          visualDesc: currentText.slice(0, 80),
          materialQuery: currentText.replace(/[，。！？、]/g, " ").slice(0, 30),
          materialQueryEn: "",
          sourceVideos: [],
          scripts: [currentText.trim()],
          wordCount: currentText.trim().length,
          estimatedDuration: Math.round(currentText.trim().length / CHARS_PER_SECOND),
        });
      }
    } else {
      scenes.push({
        sceneNumber: sceneNum++,
        title: para.slice(0, 10),
        sceneType: "REAL_FOOTAGE",
        voiceoverText: para,
        visualDesc: para.slice(0, 80),
        materialQuery: para.replace(/[，。！？、]/g, " ").slice(0, 30),
        materialQueryEn: "",
        sourceVideos: [],
        scripts: [para],
        wordCount: para.length,
        estimatedDuration: Math.round(para.length / CHARS_PER_SECOND),
      });
    }
  }

  console.log(`[quick-generate] Fallback split: ${scenes.length} scenes`);
  return scenes;
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

    // Parse material requirements from project
    let materialReqs: any = null;
    if (project.materialRequirements) {
      try { materialReqs = JSON.parse(project.materialRequirements); } catch {}
    }

    // ----- Step 1: Generate detailed storyboard via AI -----
    let scenes: SceneData[];
    let usedAI = false;
    try {
      scenes = await generateDetailedStoryboard(rawText, "A", materialReqs);
      usedAI = true;
    } catch (err) {
      console.warn("[quick-generate] AI generation failed, using fallback:", err);
      scenes = fallbackSplit(rawText);
    }

    const totalChars = scenes.reduce((sum, s) => sum + s.wordCount, 0);
    const totalDuration = Math.round(totalChars / CHARS_PER_SECOND);

    // Build productionMeta for each scene (used by render pipeline)
    const sceneCreates = scenes.map((s) => ({
      sceneNumber: s.sceneNumber,
      title: s.title,
      voiceoverText: s.voiceoverText,
      visualDesc: s.visualDesc,
      materialQuery: s.materialQuery,
      productionMeta: JSON.stringify({
        scripts: s.scripts,
        properNouns: [],
        era: "",
        sources: s.sourceVideos,
        preference: "",
        visualDesc: s.visualDesc,
        materialQuery: s.materialQuery,
        materialQueryEn: s.materialQueryEn,
        sourceVideos: s.sourceVideos,
      }),
      wordCount: s.wordCount,
      estimatedDuration: s.estimatedDuration,
      sceneType: s.sceneType as any,
    }));

    const storyboard = await prisma.storyboard.create({
      data: {
        projectId: id,
        status: "CONFIRMED",
        totalScenes: scenes.length,
        totalDuration,
        scenes: {
          create: sceneCreates,
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
          splitMethod: usedAI ? "ai-detailed" : "fallback",
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
