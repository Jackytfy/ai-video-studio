import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSession, unauthorized } from "@/lib/auth/session";
import { generateAI, buildProviderConfig, type ProviderConfig } from "@/lib/ai/router";
import { estimateAudioDuration } from "@/lib/render/subtitle";
import { fallbackSplitScenes, type SceneData } from "@/lib/ai/fallback-splitter";

/**
 * Generate detailed storyboard in one AI call using the same prompt as storyboard/generate.
 * Auto-calculates scene count based on text length.
 */
async function generateDetailedStoryboard(
  rawText: string,
  plan: "A" | "B",
  aiConfig: ProviderConfig,
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
  renderMode?: string,
): Promise<SceneData[]> {
  const chineseChars = (rawText.match(/[\u4e00-\u9fff]/g) || []).length;
  const sceneCount = Math.max(5, Math.min(30, Math.round(chineseChars / 70)));
  const wordsPerScene = Math.max(40, Math.min(80, Math.round(chineseChars / sceneCount)));

  const planDescription =
    plan === "A"
      ? "素材剪辑成片：使用实拍素材（历史影像、纪录片片段、实景拍摄）进行剪辑"
      : "素材+MG动画：混合使用实拍素材和MG动画（图形动画、数据可视化、概念动画）";

  // SceneType instruction varies by renderMode
  const isAiVideo = renderMode === "ai_video";
  const sceneTypeInstruction = isAiVideo
    ? `2. **画面类型** (sceneType): 所有场景默认使用 AI_GENERATED（AI生成视频），仅当visualDesc描述的画面在影视作品中有非常明确的对应片段时才使用 REAL_FOOTAGE
   - AI_GENERATED（默认）: 使用AI生成视频来呈现画面，适合大部分场景
   - REAL_FOOTAGE: 仅当有明确的历史影像、纪录片片段可用时使用（如著名历史事件的真实影像）
   - ANIMATION: 抽象概念、数据可视化、MG动画`
    : `2. **画面类型** (sceneType): REAL_FOOTAGE（实拍素材）或 ANIMATION（动画素材）`;

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
2. **画面类型** (sceneType): ${isAiVideo ? "AI_GENERATED（AI生成视频）或 REAL_FOOTAGE（实拍素材）" : "REAL_FOOTAGE（实拍素材）或 ANIMATION（动画素材）"}
3. **口播脚本** (voiceoverText): 该场景的完整配音文案，自然流畅的口语化表达，${wordsPerScene}字左右（40-100字）
4. **画面描述** (visualDesc): 只描述观众在屏幕上看到的画面内容。必须包含以下要素：
   - 人物：外观、服饰、动作、表情（如"身穿金色铠甲的将军"）
   - 场景：建筑、环境、天气、光影（如"阴云密布的城墙之上"）
   - 镜头：景别和运动（如"从大全景缓缓推近至面部特写"）
   - 至少50字，必须具体到可以在影视作品中找到对应片段的程度
   - ❌"古代战争场面，气氛紧张" → ✅"金色铠甲武士骑马立于古城墙上，城下旌旗密布、千军万马列阵。镜头从大全景缓缓推近至武士面部特写，逆光剪影，天空阴云密布"
5. **素材检索词** (materialQuery): 用于在Bilibili等视频平台搜索素材的关键词。**必须简短**，2-4个词，控制在10字以内。格式："核心画面词 + 类型"。**关键规则：materialQuery必须精确描述visualDesc的核心画面主体**——即观众在画面中看到的最具辨识度的视觉元素。例如：visualDesc为"金色铠甲武士骑马立于古城墙上"→ materialQuery应为"铠甲武士 电视剧"（而非笼统的"古代战争 电视剧"）。❌"日本大化改新 朝堂议事 电视剧"（太长）→ ✅"朝堂议事 电视剧"。禁止写成描述性段落，禁止超过10字
6. **口播分段** (scripts): 将口播脚本按语义拆分为2-4个自然段落，每段15-40字。这是字幕显示的依据，必须与voiceoverText完全一致（scripts拼接后必须等于voiceoverText），用于分段展示字幕
7. **英文检索词** (materialQueryEn): materialQuery对应的英文关键词，用于Pexels搜索，2-4个具体英文单词。例如："ancient battle cavalry charge"、"forbidden city aerial"
8. **素材来源** (sourceVideos): 推荐1-3个具体的电视剧、电影或纪录片名称，作为Bilibili素材搜索的优先来源。**关键规则：推荐的影视作品必须确实包含visualDesc描述的具体画面**。例如：visualDesc为"朝堂上皇帝端坐龙椅，群臣跪拜"→ sourceVideos应推荐有朝堂场景的剧（如["大明王朝1566"]），而非只有战争场面的剧。禁止推荐与visualDesc画面无关的影视作品。优先选择知名历史剧、纪录片。例如：["大明王朝1566", "大明风华"]、["河西走廊"]、["觉醒年代"]。禁止返回空数组[]——每个场景都应推荐至少1个影视来源。**只写剧名，不要加括号注释**

## 关键规则
- **口播分段(scripts)必须与voiceoverText严格一致**：scripts数组中所有段落拼接后必须等于voiceoverText，不能多字少字或改写。这是字幕同步的核心！
- **画面描述只写观众看到的画面**（人物外貌、场景、光影、镜头运动），不要包含任何旁白/口播/解说文字
- **画面与素材一致性**：sourceVideos推荐的影视作品必须在Bilibili上真实可搜到，且其中确实包含visualDesc描述的画面内容
- **一个画面一个场景**：如果口播内容跨越多个不同画面，必须拆分为多个场景
- 场景之间要有逻辑连贯性
${isAiVideo ? "- **AI生成视频模式**：大多数场景应使用AI_GENERATED。visualDesc必须详细描述AI需要生成的画面内容，因为AI将根据此描述直接生成视频。仅当有明确的历史真实影像可用时才使用REAL_FOOTAGE" : "- 优先使用实拍素材，动画仅用于抽象概念解释"}

## 输出格式
请严格按以下JSON格式输出：
{
  "title": "视频标题",
  "scenes": [
    {
      "sceneNumber": 1,
      "title": "场景标题",
      "sceneType": "${isAiVideo ? "AI_GENERATED" : "REAL_FOOTAGE"}",
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

  // aiConfig is injected by the caller (route handler) so we respect the
  // user's own provider/model/key. We must not hardcode a model here —
  // doing so silently overrode the user's settings for every quick-generate
  // request and broke users on OpenAI / custom providers.
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

  // Normalize sceneType: AI models frequently ignore or mis-format this field.
  // When renderMode=ai_video, force AI_GENERATED unless the AI explicitly chose
  // REAL_FOOTAGE (which only makes sense for well-known historical footage).
  const validSceneTypes = ["REAL_FOOTAGE", "ANIMATION", "AI_GENERATED"] as const;
  return parsed.scenes.map((s: any, idx: number) => {
    let sceneType: string = s.sceneType || "";
    // Normalize case-insensitive match (e.g. "ai_generated", "Ai Generated")
    if (!validSceneTypes.includes(sceneType as any)) {
      const upper = sceneType.toUpperCase().replace(/[\s-]/g, "_");
      if (upper === "AI_GENERATED" || upper === "AI_GENERATED_VIDEO") sceneType = "AI_GENERATED";
      else if (upper === "REAL_FOOTAGE" || upper === "REALFOOTAGE") sceneType = "REAL_FOOTAGE";
      else if (upper === "ANIMATION" || upper === "MG_ANIMATION") sceneType = "ANIMATION";
      else sceneType = ""; // unrecognised — will be overridden below
    }
    // renderMode=ai_video: default to AI_GENERATED, only keep REAL_FOOTAGE if AI chose it
    if (renderMode === "ai_video" && sceneType !== "REAL_FOOTAGE") {
      sceneType = "AI_GENERATED";
    }
    // renderMode=stock: default to REAL_FOOTAGE (don't force, allow AI to choose ANIMATION)
    if (renderMode !== "ai_video" && !sceneType) {
      sceneType = "REAL_FOOTAGE";
    }
    return {
    sceneNumber: s.sceneNumber || idx + 1,
    title: s.title || "",
    sceneType,
    voiceoverText: s.voiceoverText || "",
    visualDesc: s.visualDesc || "",
    materialQuery: s.materialQuery || "",
    materialQueryEn: s.materialQueryEn || "",
    sourceVideos: s.sourceVideos || [],
    scripts: s.scripts || [],
    wordCount: (s.voiceoverText || "").length,
    estimatedDuration: Math.round(estimateAudioDuration(s.voiceoverText || "")),
  };
  });
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
    if (!rawText || rawText.trim().length === 0) {
      await prisma.project.update({
        where: { id },
        data: { status: "FAILED" },
      }).catch(() => {});
      return NextResponse.json({ error: "文稿内容为空，请先输入视频脚本" }, { status: 400 });
    }

    // Parse material requirements from project
    let materialReqs: any = null;
    if (project.materialRequirements) {
      try { materialReqs = JSON.parse(project.materialRequirements); } catch {}
    }

    // ----- Step 1: Generate detailed storyboard via AI -----
    let scenes: SceneData[];
    let usedAI = false;

    // Resolve the user's own AI provider/model/key. We previously hardcoded
    // claude + mimo-v2.5 here, which silently ignored user settings and
    // routed every request through a single provider. `buildProviderConfig`
    // already handles decryption and the env-key fallback chain, so we just
    // hand it whatever is in the user row.
    const userRow = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { aiProvider: true, aiModel: true, aiBaseUrl: true, aiApiKey: true },
    });
    const aiConfig = buildProviderConfig({
      aiProvider: userRow?.aiProvider || undefined,
      aiModel: userRow?.aiModel || undefined,
      aiBaseUrl: userRow?.aiBaseUrl || undefined,
      aiApiKey: userRow?.aiApiKey || undefined,
    });

    try {
      scenes = await generateDetailedStoryboard(rawText, "A", aiConfig, materialReqs, project.renderMode);
      usedAI = true;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn("[quick-generate] AI generation failed:", errMsg);
      try {
        scenes = fallbackSplitScenes(rawText);
      } catch (fallbackErr) {
        console.error("[quick-generate] Fallback split also failed:", fallbackErr instanceof Error ? fallbackErr.message : fallbackErr);
        await prisma.project.update({
          where: { id },
          data: { status: "FAILED" },
        }).catch(() => {});
        return NextResponse.json({ error: "分镜生成失败，请检查文稿内容" }, { status: 500 });
      }
    }

    const totalDuration = Math.round(
      scenes.reduce((sum, s) => sum + estimateAudioDuration(s.voiceoverText || ""), 0)
    );

    if (scenes.length === 0) {
      await prisma.project.update({
        where: { id },
        data: { status: "FAILED" },
      }).catch(() => {});
      return NextResponse.json({ error: "未能生成有效场景，请调整文稿内容后重试" }, { status: 400 });
    }

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
