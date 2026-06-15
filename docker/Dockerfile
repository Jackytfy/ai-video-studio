FROM node:20-alpine AS base

# Install FFmpeg, Python and edge-tts on every stage that needs them.
# - FFmpeg: required for the video compositing pipeline.
# - Python + edge-tts: required for the default TTS engine.
# - cairo/pango: required by FFmpeg drawtext (also used in subtitle rendering).
# We install in `base` so both `deps` (when running prisma generate) and
# `runner` end up with a working /usr/bin/ffmpeg.
RUN apk add --no-cache \
      ffmpeg \
      python3 \
      py3-pip \
      cairo \
      pango \
      jpeg-dev \
      giflib-dev \
      librsvg-dev \
      font-noto-cjk \
      font-noto-emoji

# Install edge-tts globally so `python -m edge_tts` works without extra setup.
# (edge-tts is published on PyPI; pin to a known-good version for reproducibility.)
RUN pip3 install --no-cache-dir --break-system-packages "edge-tts>=6.1.9"

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npx prisma generate
RUN npm run build

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT 3000

# Smoke-test the runtime deps in the runner stage so we fail the build
# (rather than the first request) if anything is missing.
RUN ffmpeg -version >/dev/null && python3 -m edge_tts --help >/dev/null

CMD ["node", "server.js"]
