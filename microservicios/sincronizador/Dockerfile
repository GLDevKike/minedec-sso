# ==============================================================================
# Dockerfile Multi-Stage — Sincronizador de Identidades (@minedec/sincronizador)
# Cloud Run Service: sso-sincronizador (SA: sa-sso-sync)
# Cumple Constitución MINEDEC v2.11.0 (Principios IV, XIV y XVIII):
# - Imagen base oficial ligera: node:22-alpine
# - Separación estricta de etapa de compilación (builder) y ejecución (runner)
# - Consumo de @minedec/shared desde GitLab NPM Package Registry (.npmrc)
# - Ejecución obligatoria con usuario sin privilegios (USER node, non-root)
# ==============================================================================

FROM node:22-alpine AS builder
WORKDIR /workspace

ARG CI_JOB_TOKEN
ARG SHARED_PACKAGE_PROJECT_ID
COPY package.json .npmrc tsconfig.json ./
RUN npm install --ignore-scripts

COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080

RUN apk --no-cache add dumb-init

COPY --from=builder --chown=node:node /workspace/package.json ./package.json
COPY --from=builder --chown=node:node /workspace/node_modules ./node_modules
COPY --from=builder --chown=node:node /workspace/dist ./dist

USER node

EXPOSE 8080

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
