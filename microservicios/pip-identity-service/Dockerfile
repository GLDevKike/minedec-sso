# ==============================================================================
# Dockerfile — Servicio Directorio PIP (@minedec/pip-identity-service)
# Multi-stage build sobre node:22-alpine con usuario no privilegiado (USER node)
# ==============================================================================

FROM node:22-alpine AS builder
WORKDIR /workspace

ARG CI_JOB_TOKEN
COPY package*.json .npmrc ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev && rm -f .npmrc

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

RUN addgroup -g 10001 -S appgroup 2>/dev/null || true

COPY --from=builder --chown=node:node /workspace/node_modules ./node_modules
COPY --from=builder --chown=node:node /workspace/package.json ./package.json
COPY --from=builder --chown=node:node /workspace/dist ./dist
COPY --chown=node:node migrations ./migrations

USER node
EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8080/internal/v1/health || exit 1

CMD ["node", "dist/main.js"]
