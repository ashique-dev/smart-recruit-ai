FROM node:24.13.0-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@10.28.2
WORKDIR /workspace
FROM base AS development
RUN chown node:node /workspace
USER node
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
COPY --chown=node:node apps/api/package.json ./apps/api/package.json
COPY --chown=node:node apps/web/package.json ./apps/web/package.json
COPY --chown=node:node apps/worker/package.json ./apps/worker/package.json
COPY --chown=node:node packages/config/package.json ./packages/config/package.json
COPY --chown=node:node packages/shared/package.json ./packages/shared/package.json
COPY --chown=node:node packages/ai-contracts/package.json ./packages/ai-contracts/package.json
RUN pnpm install --frozen-lockfile
COPY --chown=node:node apps ./apps
COPY --chown=node:node packages ./packages
RUN pnpm build
FROM development AS build
RUN pnpm --filter @smart-recruit/worker deploy --legacy --prod /tmp/output
FROM base AS runtime
ENV NODE_ENV=development
WORKDIR /app
COPY --from=build --chown=node:node /tmp/output .
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
