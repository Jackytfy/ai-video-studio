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
请将文稿拆分为${sceneCount}个场景，每个场景包含：
1. **场景标题** (title): 简短描述场景主题
2. **画面类型** (sceneType): REAL_FOOTAGE（实拍素材）或 ANIMATION（动画素材）
3. **口播脚本** (voiceoverText): 该场景的配音文案，自然流畅的口语化表达
4. **画面描述** (visualDesc): 画面内容描述，用于素材匹配
5. **素材检索词** (materialQuery): 英文关键词，用于检索素材库

## 注意事项
- 口播脚本要自然流畅，适合配音朗读
- 每个场景的口播文案控制在80-150字
- 画面描述要具体，便于素材匹配
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
      "voiceoverText": "口播文案",
      "visualDesc": "画面描述",
      "materialQuery": "english search keywords"
    }
  ],
  "totalWords": 1200,
  "estimatedDuration": 180
}`;
}
