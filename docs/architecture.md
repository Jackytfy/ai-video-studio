# AI Video Studio 技术架构文档

## 核心技术栈

| 层级 | 技术 | 版本 |
|------|------|------|
| 框架 | Next.js (App Router) | 16.2.6 |
| 前端 | React 19 + Tailwind CSS 4 + shadcn/ui (base-nova) | - |
| 后端 | Next.js Route Handlers (API Routes) | - |
| 数据库 | SQLite (better-sqlite3) + Prisma ORM | 7.8 |
| 认证 | NextAuth v4 | 4.24.14 |
| 状态管理 | TanStack React Query v5 | 5.100.10 |
| AI | Anthropic SDK + OpenAI SDK (双 provider) | - |
| 任务队列 | BullMQ + ioredis (Redis) | - |
| 渲染 | FFmpeg (fluent-ffmpeg) + Puppeteer | - |
| TTS | Edge TTS + MiMo TTS | - |
| 存储 | AWS S3 (兼容) | - |
| 动画 | Framer Motion | 12.38.0 |
| 校验 | Zod v4 | 4.4.3 |
| 构建工具 | TypeScript 5 + ESLint 9 + PostCSS | - |

## 项目结构

```
ai-video-studio/
├── src/
│   ├── app/                        # Next.js App Router
│   │   ├── (platform)/             # 路由组 - 平台页面
│   │   │   ├── projects/[id]/      # 项目详情页
│   │   │   └── admin/              # 管理后台
│   │   └── api/                    # API 路由层
│   │       ├── auth/               # 认证 (NextAuth + 注册)
│   │       ├── projects/           # 项目 CRUD
│   │       │   └── [id]/
│   │       │       ├── chat/           # AI 对话
│   │       │       ├── analyze/        # 内容分析
│   │       │       ├── storyboard/     # 分镜生成 / 确认
│   │       │       ├── materials/      # 素材搜索 / 分配
│   │       │       ├── tts/            # 语音合成
│   │       │       ├── render/         # 渲染任务
│   │       │       └── export/         # 导出
│   │       ├── admin/              # 管理统计 API
│   │       └── user/               # 用户设置
│   ├── components/                 # UI 组件 (shadcn/ui)
│   ├── lib/                        # 核心库
│   │   ├── ai/                     # AI 调用层 (Claude / OpenAI / router)
│   │   ├── auth/                   # 认证配置与会话管理
│   │   ├── db/                     # Prisma 客户端
│   │   ├── materials/              # Pexels 素材集成
│   │   ├── render/                 # FFmpeg 渲染管线
│   │   ├── storage/                # S3 对象存储
│   │   ├── tts/                    # TTS 引擎 (Edge / MiMo)
│   │   └── utils/                  # 工具函数
│   ├── types/                      # TypeScript 类型定义
│   └── generated/prisma/           # Prisma 自动生成代码
├── prisma/
│   └── schema.prisma               # 数据模型定义
├── workers/                        # BullMQ 后台工作进程
├── docker/                         # Docker 构建配置
├── public/                         # 静态资源
├── components.json                 # shadcn/ui 配置
├── next.config.ts                  # Next.js 配置
├── prisma.config.ts                # Prisma 配置
├── tsconfig.json                   # TypeScript 配置
├── eslint.config.mjs               # ESLint 配置
└── postcss.config.mjs              # PostCSS 配置
```

## 数据模型

### ER 关系

```
User (1) ──── (*) Project (1) ──── (1?) Storyboard (1) ──── (*) Scene
  │                │                        │                     │
  │                ├── (*) ChatMessage       │                     └── (?) Material
  │                ├── (*) Material          │
  │                ├── (*) RenderJob         │
  │                └── (*) ExportJob         │
```

### 模型说明

| 模型 | 职责 | 关键字段 |
|------|------|----------|
| **User** | 用户与认证 | email, role (USER/ADMIN), aiProvider, aiModel, ttsProvider, ttsVoice |
| **Project** | 视频项目 | status (DRAFT→COMPLETED), sourceText, aspectRatio (16:9/9:16/1:1), contentStyle |
| **ChatMessage** | AI 对话历史 | role (USER/ASSISTANT/SYSTEM), messageType (TEXT/ANALYSIS/PLAN_SELECTION/STORYBOARD_CARD) |
| **Storyboard** | 分镜脚本 | title, totalScenes, totalDuration, status (GENERATING→CONFIRMED) |
| **Scene** | 单个场景 | sceneNumber, voiceoverText, visualDesc, materialQuery, transition, audioUrl, renderedUrl |
| **Material** | 素材资源 | type (VIDEO/IMAGE/AUDIO), source (STOCK/AI/USER_UPLOADED), fileUrl, matchScore |
| **RenderJob** | 渲染任务 | status (QUEUED→COMPLETED), progress, currentStage, config, outputUrl |
| **ExportJob** | 导出任务 | format (MP4_1080P/720P/4K/ProRes/GIF), status |

### 项目状态流转

```
DRAFT → ANALYZING → STORYBOARD_GENERATING → STORYBOARD_READY → PRODUCING → EDITING → RENDERING → COMPLETED
                                                                                                    ↘ FAILED
```

### 渲染阶段

```
QUEUED → PREPARING → TTS_GENERATING → MATERIALS_LOADING → COMPOSITING → SUBTITLING → POST_PROCESSING → COMPLETED
```

## 核心架构设计

### 1. AI 双引擎路由

通过 `lib/ai/router.ts` 实现 provider 抽象层，同时支持 Claude 和 OpenAI：

- 用户可在个人设置中切换 AI Provider / Model
- `lib/ai/claude.ts` — Anthropic SDK 封装
- `lib/ai/openai.ts` — OpenAI SDK 封装
- `lib/ai/prompts/analysis.ts` — 内容分析提示词模板

### 2. 异步渲染管线

渲染任务通过 BullMQ 队列异步执行，支持多阶段进度追踪：

```
┌─────────┐    ┌────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌───────────┐
│  TTS    │ →  │ 素材   │ →  │  合成    │ →  │  字幕    │ →  │  混音    │ →  │  编码     │
│ 生成    │    │ 加载   │    │ composit │    │ 渲染     │    │ 混合     │    │ 输出      │
└─────────┘    └────────┘    └──────────┘    └──────────┘    └──────────┘    └───────────┘
```

- `workers/index.ts` — 独立 Worker 进程入口
- `lib/render/pipeline.ts` — 渲染管线编排
- `lib/render/ffmpeg.ts` — FFmpeg 操作封装

### 3. TTS 语音合成

- **Edge TTS** (`lib/tts/edge-tts.ts`) — 微软免费 TTS，支持中文语音
- **MiMo TTS** (`lib/tts/mimo-tts.ts`) — 备选方案

### 4. 素材管理

- `lib/materials/pexels.ts` — Pexels API 集成，根据分镜描述搜索匹配素材
- 支持素材搜索 (`materials/search`) 和分配 (`materials/assign`)
- 匹配度评分 (`matchScore`) 用于素材质量排序

### 5. 存储方案

- `lib/storage/s3.ts` — AWS S3 兼容存储，用于视频/音频/素材文件
- `dev.db` — 本地 SQLite 开发数据库

## 部署架构

```
┌─────────────────────────────────────────┐
│              Docker Container            │
│  ┌──────────────┐  ┌─────────────────┐  │
│  │  Next.js App │  │  Worker Process │  │
│  │  (standalone)│  │  (BullMQ)       │  │
│  └──────┬───────┘  └───────┬─────────┘  │
│         │                  │             │
│  ┌──────┴──────────────────┴──────────┐  │
│  │         Redis (BullMQ Broker)      │  │
│  └────────────────────────────────────┘  │
│  ┌────────────────────────────────────┐  │
│  │      SQLite / External DB          │  │
│  └────────────────────────────────────┘  │
└─────────────────────────────────────────┘
         │
         ▼
  ┌──────────────┐
  │  S3 Storage  │
  └──────────────┘
```

- Next.js 使用 `output: "standalone"` 模式，适合容器化部署
- Worker 进程独立运行，通过 Redis 与主应用通信
- `docker/` 目录包含 Dockerfile.workers

## 开发脚本

```bash
npm run dev       # 启动 Next.js 开发服务器
npm run build     # 构建生产版本
npm run start     # 启动生产服务器
npm run worker    # 启动 BullMQ Worker 进程
npm run lint      # ESLint 检查
```
