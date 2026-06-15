# AI Video Studio — 全自动知识科普视频生成平台

基于 Next.js 的全栈 AI 视频创作平台。输入文案 → AI 生成分镜脚本 → TTS 配音 → 自动搜索匹配素材 → 合成视频导出。

## 系统依赖

渲染管线依赖以下系统工具，请确保本地已安装：

- **[FFmpeg](https://ffmpeg.org/)** ≥ 5.0（视频编码 + 滤镜）
- **[Python](https://www.python.org/)** ≥ 3.9（Edge TTS 语音合成）
- **[edge-tts](https://pypi.org/project/edge-tts/)**：`pip install edge-tts`
- **[Cairo / Pango](https://www.cairographics.org/)**（Linux，MG 动画渲染所需的字体库）

### Docker 部署

```bash
# 构建镜像（包含 ffmpeg/python3/edge-tts/cairo）
docker build -t ai-video-studio -f docker/Dockerfile .

# 或使用 docker-compose
docker compose -f docker/docker-compose.yml up -d
```

### Standalone 构建注意事项

项目使用 `output: "standalone"` 模式运行。`better-sqlite3` 包含原生 C++ 绑定，
**跨平台部署时必须重新构建**：

```bash
# Linux 服务器上构建
npm install
npx prisma generate        # ← 必须在构建机执行，生成原生绑定
npm run build
```

Windows 构建的 `.next/standalone` 无法直接在 Linux 容器中运行。

## 开发

```bash
npm install
npx prisma db push        # 初始化数据库
npx prisma db seed        # 可选：种子数据
npm run dev               # http://localhost:3000
```

## 关键 API

| 端点 | 说明 |
|:---|:---|
| `GET /api/health` | 健康检查（DB/FFmpeg/内存） |
| `POST /api/projects/[id]/render` | 启动渲染（限流：10次/时） |
| `POST /api/projects/[id]/render/cancel` | 取消渲染 |
| `GET /api/projects/[id]/events` | SSE 事件流（渲染进度） |

## 技术栈

- **框架**：Next.js 15 (App Router)
- **数据库**：SQLite (better-sqlite3 + WAL 模式)
- **AI**：Anthropic Claude / OpenAI / MiMo（自动降级）
- **TTS**：Edge TTS / MiMo TTS
- **渲染**：FFmpeg（视频合成 + 字幕 + 去水印）
- **存储**：本地文件系统 / S3 (MinIO)

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
