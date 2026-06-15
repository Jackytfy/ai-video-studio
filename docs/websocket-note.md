# WebSocket vs SSE — Recommendation

## Current State

The `useProjectEvents` hook uses SSE (`EventSource`) for real-time render progress.
The project page uses React Query polling as a fallback (5s interval).

## Why SSE is sufficient (for now)

- **One-way**: render progress only needs server → client push
- **Native browser API**: no library needed, auto-reconnect built-in
- **HTTP/2 friendly**: multiplexed connections
- **Works with Next.js App Router**: `ReadableStream` SSE response

## When to switch to WebSocket

Consider `ws` or Socket.io when:

1. **Bidirectional is needed** — e.g., user cancels render mid-stream without a separate HTTP request
2. **Chat feature** — the chat page already uses polling; WebSocket would enable real-time messages
3. **High-frequency updates** — SSE's polling interval (2s) is too slow
4. **Multiple event types** — structured channels (render:scene-0, render:progress, chat:message)

## Implementation path

```typescript
// Option A: ws library (lightweight)
import { WebSocketServer } from "ws";
const wss = new WebSocketServer({ server });

// Option B: Socket.io (full-featured, rooms support)
const io = new Server(server, { cors: { origin: "*" } });
io.to(`project:${projectId}`).emit("render:progress", { progress: 50 });
```

**Recommendation**: Keep SSE for now. Switch to WebSocket when the chat feature goes production-ready or when cancel-from-progress is needed.

## Migration checklist

- [ ] Install `ws` or `socket.io`
- [ ] Create `/api/ws` handler (Next.js custom server or standalone)
- [ ] Update `useProjectEvents` to use WebSocket client
- [ ] Remove SSE `/api/projects/[id]/events` route
- [ ] Add typed event protocol (shared between server and client)
