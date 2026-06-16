import { ContentStyle } from "@/types/project";

export interface MaterialRequirements {
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
}

export function getAnalysisPrompt(
  text: string,
  style: ContentStyle,
  materialReqs?: MaterialRequirements | null,
): string {
  const styleDescription = {
    KNOWLEDGE: "知识科普类短视频，注重信息准确性和趣味性",
    CULTURE: "历史文化类视频，注重文化底蕴和视觉表现",
    CLASSIC_HISTORY: "经典历史解读视频，注重历史考据和叙事深度",
    CUSTOM: "自定义风格",
  }[style];

  // Build material requirements section for prompt
  let materialReqSection = "";
  if (materialReqs) {
    const parts: string[] = [];
    if (materialReqs.contentSummary) {
      parts.push(`**内容摘要**：${materialReqs.contentSummary}`);
    }
    if (materialReqs.referenceStyle) {
      parts.push(`**参考风格**：${materialReqs.referenceStyle}`);
    }
    if (materialReqs.requiredSources?.length) {
      parts.push(`**必须使用的素材来源**：${materialReqs.requiredSources.join("、")}`);
    }
    if (materialReqs.preferredSources?.length) {
      parts.push(`**推荐素材来源**：${materialReqs.preferredSources.join("、")}`);
    }
    if (materialReqs.materialTypes?.length) {
      parts.push(`**素材类型优先级**：${materialReqs.materialTypes.join(" > ")}`);
    }
    if (materialReqs.properNouns?.length) {
      parts.push(`**必须出现的人物/地名**：${materialReqs.properNouns.join("、")}`);
    }
    if (materialReqs.landmarkScenes?.length) {
      parts.push(`**标志性场景**：${materialReqs.landmarkScenes.join("、")}`);
    }
    if (materialReqs.stylePreference) {
      parts.push(`**画面风格偏好**：${materialReqs.stylePreference}`);
    }
    if (materialReqs.regionLimit) {
      parts.push(`**地域限定**：${materialReqs.regionLimit}`);
    }
    if (materialReqs.avoidKeywords?.length) {
      parts.push(`**避免出现的素材**：${materialReqs.avoidKeywords.join("、")}`);
    }
    if (parts.length > 0) {
      materialReqSection = `\n## 用户素材需求（分析时必须考虑）\n${parts.join("\n")}\n`;
    }
  }

  return `你是一个专业的视频内容分析师。请分析以下文稿内容，为视频制作提供专业建议。

## 文稿内容
${text}
${materialReqSection}

## 视频类型
${styleDescription}

## 分析要求
请从以下维度进行分析，并以JSON格式返回结果：

1. **内容摘要** (summary): 用100字以内概括文稿核心内容
2. **关键实体** (entities): 提取文稿中提到的人物、地点、事件、时代背景
3. **内容分类** (contentCategory): 细分内容类型（如：历史故事、科学知识、文化解读等）
4. **关键主题** (keyTopics): 提取3-5个核心主题关键词
5. **制作方案推荐** (suggestedPlan):
   - 方案A "素材剪辑成片": 适合有明确历史场景、人物故事的内容
   - 方案B "素材+MG动画": 适合需要解释抽象概念、数据可视化的内容
6. **推荐理由** (planReason): 为什么推荐这个方案
7. **场景数量** (sceneCount): 建议拆分的场景数量（按每60-80字一个场景计算，一般10-25个，内容越长场景越多）
8. **预估时长** (estimatedDuration): 预估视频总时长（秒）

## 输出格式
请严格按以下JSON格式输出，不要包含其他内容：
{
  "summary": "内容摘要",
  "entities": {
    "people": ["人物1", "人物2"],
    "places": ["地点1", "地点2"],
    "events": ["事件1", "事件2"],
    "timePeriods": ["时代1", "时代2"]
  },
  "contentCategory": "内容分类",
  "keyTopics": ["主题1", "主题2", "主题3"],
  "suggestedPlan": "A或B",
  "planReason": "推荐理由",
  "sceneCount": 10,
  "estimatedDuration": 180
}`;
}

export function getStoryboardPrompt(
  text: string,
  plan: "A" | "B",
  sceneCount: number
): string {
  const planDescription =
    plan === "A"
      ? "素材剪辑成片：使用实拍素材（历史影像、纪录片片段、实景拍摄）进行剪辑"
      : "素材+MG动画：混合使用实拍素材和MG动画（图形动画、数据可视化、概念动画）";

  // Calculate optimal words per scene based on total text length
  const chineseChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const wordsPerScene = Math.max(40, Math.min(80, Math.round(chineseChars / sceneCount)));

  return `你是一个专业的视频分镜师。请根据以下文稿和制作方案，生成详细的分镜脚本。

## 文稿内容
${text}

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
5. **素材检索词** (materialQuery): 用于在Bilibili等视频平台搜索素材的关键词。**必须简短**，2-4个词，控制在10字以内。格式："核心画面词 + 类型"。**关键规则：materialQuery必须精确描述visualDesc的核心画面主体**——即观众在画面中看到的最具辨识度的视觉元素。例如：visualDesc为"金色铠甲武士骑马立于古城墙上"→ materialQuery应为"铠甲武士 电视剧"（而非笼统的"古代战争 电视剧"）。再如：visualDesc为"僧人在古寺大殿内诵经"→ materialQuery应为"古寺诵经 纪录片"（而非"佛教 纪录片"）。❌"日本大化改新 朝堂议事 电视剧"（太长）→ ✅"朝堂议事 电视剧"。❌"平城京 长安城 地图对比 纪录片"（太长）→ ✅"长安城 纪录片"。禁止写成描述性段落，禁止超过10字
6. **口播分段** (scripts): 将口播脚本按语义拆分为2-4个自然段落，每段15-40字。这是字幕显示的依据，必须与voiceoverText完全一致（scripts拼接后必须等于voiceoverText），用于分段展示字幕
7. **英文检索词** (materialQueryEn): materialQuery对应的英文关键词，用于Pexels搜索，2-4个具体英文单词。例如："ancient battle cavalry charge"、"forbidden city aerial"
8. **素材来源** (sourceVideos): 推荐1-3个具体的电视剧、电影或纪录片名称，作为Bilibili素材搜索的优先来源。**关键规则：推荐的影视作品必须确实包含visualDesc描述的具体画面**。例如：visualDesc为"朝堂上皇帝端坐龙椅，群臣跪拜"→ sourceVideos应推荐有朝堂场景的剧（如["大明王朝1566"]），而非只有战争场面的剧（如["大秦帝国"]）。禁止推荐与visualDesc画面无关的影视作品。优先选择知名历史剧、纪录片。例如：["大明王朝1566", "大明风华"]、["河西走廊"]、["觉醒年代"]、["大秦帝国"]、["三国演义"]、["贞观之治"]、["走向共和"]。禁止返回空数组[]——每个场景都应推荐至少1个影视来源。**只写剧名，不要加括号注释**（❌"长安十二时辰（文化氛围）" → ✅"长安十二时辰"）

## 关键规则
- **口播分段(scripts)必须与voiceoverText严格一致**：scripts数组中所有段落拼接后必须等于voiceoverText，不能多字少字或改写。这是字幕同步的核心！
- **画面描述只写观众看到的画面**（人物外貌、场景、光影、镜头运动），不要包含任何旁白/口播/解说文字
- **画面与素材一致性**：sourceVideos推荐的影视作品必须在Bilibili上真实可搜到，且其中确实包含visualDesc描述的画面内容。materialQuery必须精确描述visualDesc的核心画面主体，而非笼统的主题词。三者（visualDesc、materialQuery、sourceVideos）必须指向同一个具体画面
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
}
