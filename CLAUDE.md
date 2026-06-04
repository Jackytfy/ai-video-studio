# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Next.js dev server (port 3000)
pnpm build        # Production build
pnpm start        # Production server
pnpm worker       # BullMQ render worker (requires Redis)
pnpm lint         # ESLint

# Prisma
npx prisma generate        # Regenerate client → src/generated/prisma/
npx prisma migrate dev     # Run migrations
npx prisma studio          # DB browser

# Scripts
node scripts/seed-test.mjs        # Seed test data
node scripts/check-db.cjs         # Inspect DB state
node scripts/direct-render.cjs    # Test render pipeline directly
```

## Architecture

**Text-to-video creation platform.** User inputs text → AI analyzes → generates storyboard → searches stock footage → TTS audio → FFmpeg composites final video with subtitles.

### Core Pipeline (project lifecycle)

1. **Create** — user submits text + style → `POST /api/projects`
2. **Analyze** — AI extracts entities, topics, suggests plan → `/api/projects/[id]/analyze`
3. **Storyboard** — AI generates scenes with voiceover text → `/api/projects/[id]/storyboard/generate`
4. **Materials** — Multi-platform search (Pexels + Pixabay + Bilibili) per scene → `/api/projects/[id]/materials/search`
5. **Render** — TTS + FFmpeg compositing + subtitles → `/api/projects/[id]/render`
6. **Export** — Final video download → `/api/projects/[id]/export`

### Two Render Paths

- **Inline** (`src/lib/render/pipeline.ts`) — `renderProjectInline()`: runs in Next.js server process. Uses local filesystem in `uploads/`. Default path via API route.
- **Worker** (`workers/index.ts`) — BullMQ worker with Redis. Uploads to S3. Run separately via `pnpm worker`. Stages: TTS → Materials → Compose.

Both share `src/lib/render/subtitle.ts` for subtitle generation.

### AI Provider Abstraction

`src/lib/ai/router.ts` — `getAIProvider(config)` returns Claude or OpenAI provider.

- **Claude**: `@anthropic-ai/sdk`, model `claude-sonnet-4-20250514`
- **OpenAI-compatible**: works with OpenAI API, also supports Xiaomi MiMo (`api-key` header auth, not Bearer)
- **Auto-fallback**: Claude → MiMo → OpenAI based on available env keys
- User can configure per-user provider/model/key in DB (stored on User model)

### TTS (Text-to-Speech)

- **Edge TTS** (default): calls `python -m edge_tts` CLI. Requires Python + `edge-tts` package installed.
- **MiMo TTS**: API call to `mimo-v2.5-tts` model, returns base64 audio.
- Per-user config: `ttsProvider` + `ttsVoice` on User model.

### Database

SQLite via Prisma + `better-sqlite3` adapter. Client generated to `src/generated/prisma/`. Schema at `prisma/schema.prisma`.

Key models: `User`, `Project`, `Storyboard`, `Scene`, `Material`, `RenderJob`, `ExportJob`, `VideoSegment`, `MusicTrack`.

### Storage

- **Local mode** (inline render): files saved to `uploads/{projectId}/output/`, served via `/api/uploads/[...path]`
- **S3 mode** (worker): MinIO/S3-compatible storage via `@aws-sdk/client-s3`

### Auth

NextAuth v4 with credentials provider. **Currently effectively disabled** — `requireSession()` in `src/lib/auth/session.ts` returns a hardcoded default user when no session exists. Middleware matcher is empty.

### Frontend

- Next.js 16 App Router, React 19, Tailwind CSS 4, shadcn/ui components
- `@tanstack/react-query` for data fetching
- Route groups: `(auth)` for login/register, `(platform)` for main app (sidebar + header layout)
- Landing page redirects to `/dashboard`

## External Dependencies

| Dependency | Purpose | Required? |
|---|---|---|
| FFmpeg + FFprobe | Video compositing, audio duration detection | Yes (must be in PATH) |
| Python + edge-tts | Default TTS engine | Yes (for Edge TTS) |
| Chrome/Edge | Puppeteer fallback for image search | Optional |
| Redis | BullMQ worker queue | Only for worker mode |
| S3/MinIO | Object storage | Only for worker mode |

## Environment Variables

See `.env.example`. Required: `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`. At least one AI key: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `MIMO_API_KEY`. Optional: `PEXELS_API_KEY` (stock footage), `S3_*` (worker storage).

## Path Aliases

`@/*` maps to `./src/*` (configured in tsconfig.json).

## Windows FFmpeg Font Path

FFmpeg drawtext on Windows needs `C\:/Windows/Fonts/msyh.ttc` (backslash before colon). Use `String.fromCharCode(67,92,58) + "/Windows/Fonts/msyh.ttc"` in code — literal `"C\\:"` gets corrupted by PowerShell shell escaping.

## Material Search Priority

Bilibili searched first (Chinese content, historical/cultural match), then Pexels/Pixabay as fallback (royalty-free). Bilibili results have watermarks — auto-cropped 2% edges during render.

## Next.js 16 Notes

This project uses Next.js 16.2.6 — check `node_modules/next/dist/docs/` for breaking changes before writing code. Key known patterns:
- Route params are `Promise<{ id: string }>` (async params)
- `output: "standalone"` for deployment
- `serverExternalPackages` for native modules (better-sqlite3, Prisma)
