# Etapa 1: Construcción TypeScript 5.8+ (Constitución MINEDEC Principio IX / XVIII)
FROM node:22-alpine AS builder
WORKDIR /app

ARG SHARED_NPM_PROJECT_ID
ARG CI_JOB_TOKEN

COPY package.json .npmrc tsconfig.json ./
RUN npm install --ignore-scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev

# Etapa 2: Ejecución endurecida non-root para GKE Autopilot (sa-sso-core)
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY --from=builder --chown=appuser:appgroup /app/package.json ./package.json
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist

USER appuser
EXPOSE 8080

CMD ["node", "dist/main.js"]
