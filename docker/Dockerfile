# T04：Next.js standalone 自架 image。於 repo 根目錄建置：docker build -f docker/Dockerfile .
# S-13：以非 root 使用者執行；不含 .env 與任何 API key（設定一律於執行時以環境變數傳入）

FROM node:26-alpine AS base
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@10.34.9
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/web/package.json apps/web/
COPY packages/ai/package.json packages/ai/
COPY packages/core/package.json packages/core/
COPY packages/data-sources/package.json packages/data-sources/
COPY packages/db/package.json packages/db/
COPY packages/memory/package.json packages/memory/
COPY packages/offline/package.json packages/offline/
COPY packages/regions/package.json packages/regions/
COPY packages/schemas/package.json packages/schemas/
COPY packages/security/package.json packages/security/
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY . .
RUN pnpm --filter @atps/web build

FROM node:26-alpine AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "apps/web/server.js"]
