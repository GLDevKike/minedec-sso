# Stage 1: Build
FROM node:22-alpine AS builder
WORKDIR /app

ARG CI_JOB_TOKEN
ARG MINEDEC_SHARED_PROJECT_ID=101

COPY package*.json .npmrc ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev && rm -f .npmrc

# Stage 2: Production Runtime (Non-Root)
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

USER node

COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

ENTRYPOINT ["node", "dist/main.js"]
