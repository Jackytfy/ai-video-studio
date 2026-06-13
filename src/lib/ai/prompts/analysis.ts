import { ContentStyle } from "@/types/project";

export function getAnalysisPrompt(
  text: string,
  style: ContentStyle
): string {
  const styleDescription = {
    KNOWLEDGE: "知识科普类短视频，注重信息准确性和趣味性",
    CULTURE: "历史文化类视频，注重文化底蕴和视觉表现",
    CLASSIC_HISTORY: "经典历史解读视频，注重历史考据和叙事深度",
    CUSTOM: "自定义风格",
  }[style];

  return `你是一个专业的视频内容分析师。请分析以下文稿内容，为视频制作提供专业建议。

## 文稿内容
${text}

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
7. **场景数量** (sceneCount): 建议拆分的场景数量（一般8-15个）
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

  return `你是一个专业的视频分镜师。请根据以下文稿和制作方案，生成详细的分镜脚本。

## 文稿内容
${text}

## 制作方案
${planDescription}

## 分镜要求
请将文稿拆分为${sceneCount}个场景，每个场景包含以下字段：

1. **场景标题** (title): 简短描述场景主题
2. **画面类型** (sceneType): REAL_FOOTAGE（实拍素材）或 ANIMATION（动画素材）
3. **口播脚本** (voiceoverText): 该场景的完整配音文案，自然流畅的口语化表达，80-150字
4. **画面描述** (visualDesc): 只描述观众在屏幕上看到的画面内容（人物外观、场景环境、光影、镜头运动、画面构图），不要包含任何口播/旁白文字，至少30字。画面描述必须具体到可以在影视作品中找到对应片段的程度。例如：❌"古代战争场面，气氛紧张" → ✅"金色铠甲武士骑马立于古城墙上，城下旌旗密布、千军万马列阵。镜头从大全景缓缓推近至武士面部特写，逆光剪影，天空阴云密布"。关键：必须包含可辨识的具体画面元素（人物动作、服饰、场景建筑、道具等），而非抽象描述
5. **素材检索词** (materialQuery): 用于在Bilibili等视频平台搜索素材的关键词，必须是简洁的搜索词组，不是描述性段落。格式："核心画面内容 + 时代/风格"，控制在15字以内。例如："明朝朝堂议事 电视剧片段"、"古代战场骑兵冲锋"、"紫禁城太和殿 空镜"、"朱元璋 登基 大殿"。禁止写成段落（如"画面风格应具有强烈的戏剧冲突..."），禁止包含色调、氛围、镜头运动等描述词
6. **口播分段** (scripts): 将口播脚本按语义拆分为2-4个自然段落，每段15-40字，用于分段展示
7. **英文检索词** (materialQueryEn): materialQuery对应的英文关键词，用于Pexels搜索，2-4个具体英文单词。例如："ancient battle cavalry charge"、"forbidden city aerial"、"chinese palace throne room"
8. **素材来源** (sourceVideos): 推荐1-3个具体的电视剧、电影或纪录片名称，作为Bilibili素材搜索的优先来源。这是确保画面与描述一致的关键字段！必须选择画面质量高、与场景内容高度匹配的影视作品。优先选择知名历史剧、纪录片，确保在Bilibili上能搜到。例如：["大明王朝1566", "大明风华"]、["河西走廊"]、["觉醒年代"]、["大秦帝国"]、["三国演义"]、["贞观之治"]、["走向共和"]。如果场景涉及日本历史，推荐：["大河剧 龙马传"]、["军师官兵卫"]、["镰仓殿的13人"]。禁止返回空数组[]——每个场景都应推荐至少1个影视来源

## 注意事项
- 口播脚本要自然流畅，适合配音朗读
- 每个场景的口播文案控制在80-150字
- 画面描述只写观众看到的画面（人物外貌、场景、光影、镜头运动），不要包含任何旁白/口播/解说文字
- 画面描述和口播脚本必须严格分开：画面描述=看到什么，口播脚本=听到什么
- 素材检索词必须是简洁的搜索关键词（15字以内），不要写成描述性段落
- 场景之间要有逻辑连贯性
- 优先使用实拍素材，动画仅用于抽象概念解释
- **画面与素材一致性**：sourceVideos推荐的影视作品必须在Bilibili上真实可搜到，且其中确实包含visualDesc描述的画面内容。不要推荐与画面无关的影视作品
- **素材来源必须具体**：不要推荐模糊的来源如"历史纪录片"，必须给出具体名称如"河西走廊 第3集"

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
      "visualDesc": "详细的画面描述，包含人物、环境、镜头运动、光影效果...",
      "materialQuery": "中文素材检索条件，包含内容+色调+风格+氛围",
      "materialQueryEn": "english keywords for stock footage search",
      "sourceVideos": ["推荐的影视来源1", "推荐的影视来源2"],
      "scripts": ["口播分段1", "口播分段2", "口播分段3"]
    }
  ],
  "totalWords": 1200,
  "estimatedDuration": 180
}`;
}
