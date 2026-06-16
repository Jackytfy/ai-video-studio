     当前系统是纯素材搜索型视频制作工具：AI 生成分镜 → 搜索 Bilibili/Pexels 素材 → 下载 → FFmpeg 合成。用户希望增加根据脚本直接生成画面的能力，使用 Agnes Video V2.0
     API（Text-to-Video），作为素材搜索的替代路径，不影响原有逻辑。

     Schema 已预埋支持：SceneType.AI_GENERATED、MaterialSource.AI_GENERATED、Material.aiPrompt/aiProvider 字段均已存在但未接入。

     Agnes Video V2.0 API 摘要

     - 异步任务制：POST 创建任务 → 轮询状态 → 获取视频 URL
     - 端点：POST https://apihub.agnes-ai.com/v1/videos，轮询：GET https://apihub.agnes-ai.com/agnesapi?video_id=<ID>
     - 参数：model=agnes-video-v2.0, prompt(英文), width, height, num_frames(8n+1, ≤441), frame_rate(1-60)
     - 返回：{ status: "completed", remixed_from_video_id: "<video_url>" }
     - 还支持 Image-to-Video、Multi-Image Video、Keyframe Animation

     架构设计

     核心原则：AI 生成视频是素材来源的替代，不是流水线重构。插入点在素材获取阶段，生成结果走相同的 FFmpeg 合成路径。

     分镜确认 → 场景遍历
       ├─ REAL_FOOTAGE → 搜索 Bilibili/Pexels（原逻辑，不变）
       ├─ ANIMATION    → MG 动画（原逻辑，不变）
       └─ AI_GENERATED → Agnes API 生成视频（新增）
                           ├─ 成功 → 下载 → 合成（跳过水印去除）
                           └─ 失败 → 降级到素材搜索

     修改文件清单

     ┌───────────────────────────────────────────────────────┬──────┬──────────────────────────────────────────────┐
     │                         文件                          │ 类型 │                     说明                     │
     ├───────────────────────────────────────────────────────┼──────┼──────────────────────────────────────────────┤
     │ src/lib/video-gen/agnes.ts                            │ 新建 │ Agnes API 客户端                             │
     ├───────────────────────────────────────────────────────┼──────┼──────────────────────────────────────────────┤
     │ src/lib/video-gen/index.ts                            │ 新建 │ 场景级生成编排 + prompt 构建                 │
     ├───────────────────────────────────────────────────────┼──────┼──────────────────────────────────────────────┤
     │ src/lib/render/pipeline.ts                            │ 修改 │ Materials Loading 阶段插入 AI_GENERATED 分支 │
     ├───────────────────────────────────────────────────────┼──────┼──────────────────────────────────────────────┤
     │ src/app/api/projects/[id]/storyboard/confirm/route.ts │ 修改 │ 跳过 AI_GENERATED 场景的素材搜索             │
     ├───────────────────────────────────────────────────────┼──────┼──────────────────────────────────────────────┤
     │ src/lib/ai/prompts/analysis.ts                        │ 修改 │ 分镜 prompt 允许输出 AI_GENERATED            │
     ├───────────────────────────────────────────────────────┼──────┼──────────────────────────────────────────────┤
     │ src/lib/ai/types.ts                                   │ 修改 │ SceneInput.sceneType 联合类型扩展            │
     ├───────────────────────────────────────────────────────┼──────┼──────────────────────────────────────────────┤
     │ .env.example                                          │ 修改 │ 添加 AGNES_API_KEY                           │
     └───────────────────────────────────────────────────────┴──────┴──────────────────────────────────────────────┘

     Change 1: src/lib/video-gen/agnes.ts（新建）

     Agnes API 封装层，3 个核心函数：

     interface AgnesVideoOptions {
       height?: number;       // 默认 768
       width?: number;        // 默认 1152
       numFrames?: number;    // 8n+1, 默认 121
       frameRate?: number;    // 默认 24
       model?: string;        // 默认 "agnes-video-v2.0"
     }

     async function createVideoTask(
       prompt: string,
       options?: AgnesVideoOptions
     ): Promise<{ taskId: string; videoId: string }>

     async function pollVideoResult(
       videoId: string,
       onProgress?: (status: string) => void
     ): Promise<{ status: string; videoUrl: string | null; seconds: number }>

     async function downloadVideo(
       videoUrl: string,
       outputPath: string
     ): Promise<void>

     - API Key 从 process.env.AGNES_API_KEY 读取
     - createVideoTask: POST https://apihub.agnes-ai.com/v1/videos，Bearer auth
     - pollVideoResult: GET 轮询，5 秒间隔，最多 120 次（10 分钟超时）
     - downloadVideo: fetch + stream pipeline（复用 pipeline.ts 现有下载模式）

     Change 2: src/lib/video-gen/index.ts（新建）

     场景级编排，桥接 Scene 数据到 Agnes API：

     interface VideoGenResult {
       filePath: string;    // 本地下载路径
       duration: number;    // 秒
       width: number;
       height: number;
       aiPrompt: string;    // 实际使用的英文 prompt
       videoId: string;     // Agnes video ID
     }

     async function generateVideoFromScene(
       scene: {
         visualDesc: string;
         voiceoverText: string;
         materialQuery?: string;
         sceneNumber: number;
       },
       workDir: string,
       config: { width: number; height: number; fps: number },
       onProgress?: (status: string) => void
     ): Promise<VideoGenResult | null>

     Prompt 构建逻辑 (buildAgnesPrompt):
     - 从 visualDesc 提取主体、动作、场景、镜头、光影
     - 若有 materialQueryEn，作为英文基础描述
     - 格式：[Subject] + [Action] + [Scene] + [Camera] + [Lighting] + [Style]
     - 例："A warrior in golden armor riding a horse on ancient city walls, flags below, slow cinematic push-in, dramatic backlighting, documentary style"

     num_frames 计算：
     - neededFrames = ceil(voiceoverDuration × frameRate / 8) × 8 + 1
     - 钳制到 [81, 441]

     失败处理：返回 null，调用方降级到素材搜索。

     Change 3: pipeline.ts — Materials Loading 阶段插入

     位置：mapConcurrent 回调内（约 line 752），在现有 autoSearchBilibili() 之前。

     // ── AI 生成视频分支 ──
     if (scene.sceneType === "AI_GENERATED" && !materialLoaded) {
       if (process.env.AGNES_API_KEY) {
         try {
           更新 RenderJob.stageProgress → "ai_generation"

           const genResult = await generateVideoFromScene(
             { visualDesc, voiceoverText, materialQuery, sceneNumber },
             workDir,
             { width, height, fps },
             (status) => console.log(...)
           );

           if (genResult) {
             // 直接使用 genResult.filePath 作为素材
             // AI_GENERATED 已在 line 1555 跳过去水印，无需额外修改
             materialLoaded = true;
           }
         } catch (err) {
           console.warn(`AI generation failed, falling back:`, err);
         }
       } else {
         console.warn(`AI_GENERATED but AGNES_API_KEY not set`);
       }
       // 失败则 fall through 到现有素材搜索
     }

     关键点：
     - materialLoaded 标志控制后续所有 fallback 逻辑，成功即跳过
     - AI 生成视频走相同 FFmpeg 缩放/滤镜管线
     - Material.source === "AI_GENERATED" 已在 line 1555 跳过去水印

     Change 4: confirm/route.ts — 跳过 AI_GENERATED 场景

     位置：素材搜索循环内（约 line 115），skip check 之后。

     // 在现有的 "无 materialQuery/visualDesc → skip" 之后：
     if (scene.sceneType === "AI_GENERATED") {
       console.log(`[Confirm] Scene ${scene.sceneNumber}: AI_GENERATED, deferred to render pipeline`);
       continue; // 不做素材搜索，渲染时由 pipeline 处理
     }

     设计决策：确认时不生成视频，避免：
     - 用户重新确认时浪费 API 调用
     - 视频 URL 在渲染前过期
     - 重复下载逻辑

     Change 5: analysis.ts — 分镜 prompt 扩展

     在 getStoryboardPrompt() 的 sceneType 字段说明中添加 AI_GENERATED：

     2. **画面类型** (sceneType):
        - REAL_FOOTAGE（实拍素材）：有明确历史影像、纪录片可用（默认）
        - ANIMATION（动画）：抽象概念、数据可视化
        - AI_GENERATED（AI生成）：画面高度具体但影视中极难找到对应片段
          （如奇幻场景、超现实画面、无影像记录的历史场景）
          仅在确实无法通过素材搜索匹配时使用

     Change 6: types.ts — SceneInput 扩展

     sceneType: "REAL_FOOTAGE" | "ANIMATION" | "AI_GENERATED";

     Change 7: .env.example — 环境变量

     # AI Video Generation (optional, pay-per-use)
     # Agnes Video V2.0 — https://agnes-ai.com
     AGNES_API_KEY=""

     成本控制策略

     1. Opt-in：AGNES_API_KEY 未设置时，AI_GENERATED 场景自动降级到素材搜索
     2. AI 建议，用户控制：分镜 prompt 仅在极少数场景建议 AI_GENERATED；用户可在 SceneEditor 覆盖
     3. 静默降级：生成失败 → 日志警告 → 自动走素材搜索路径
     4. 审计追踪：Material 记录存储 aiPrompt + aiProvider

     执行顺序

     1. Phase 1 — 新建 agnes.ts + index.ts（独立模块，无现有代码改动）
     2. Phase 2 — 修改 types.ts + .env.example（类型扩展）
     3. Phase 3 — 修改 pipeline.ts（核心集成，最大改动）
     4. Phase 4 — 修改 confirm/route.ts（跳过逻辑）
     5. Phase 5 — 修改 analysis.ts（分镜 prompt）
     6. Phase 6 — 测试：混合项目（部分 REAL_FOOTAGE + 部分 AI_GENERATED）

     验证方式

     # 1. 类型检查
     npx tsc --noEmit

     # 2. 无 AGNES_API_KEY 时：AI_GENERATED 场景降级到素材搜索
     #    检查日志："[Render] Scene X AI_GENERATED but AGNES_API_KEY not set, falling back"

     # 3. 有 AGNES_API_KEY 时：AI_GENERATED 场景调用 Agnes API
     #    检查：downloads/agnes-{sceneNumber}.mp4 存在
     #    检查：Material 记录 source="AI_GENERATED", aiPrompt 非空

     # 4. 混合项目：部分场景 REAL_FOOTAGE + 部分 AI_GENERATED
     #    验证两类场景各自走正确路径，最终合成完整视频