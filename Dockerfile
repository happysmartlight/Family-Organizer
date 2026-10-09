# --- STAGE 1: BUILD ---
FROM node:22-alpine AS builder

WORKDIR /app

# Install build tools if native modules need compiling
RUN apk add --no-cache python3 make g++

# Copy dependency files
COPY package*.json ./

# Install dependencies (including devDependencies for compiling)
# Note: repo has no package-lock.json, so use `npm install` (not `npm ci`).
RUN npm install

# Copy the rest of the application files
COPY tsconfig.json vite.config.ts index.html metadata.json ./
COPY public/ ./public/
COPY src/ ./src/
COPY server.ts ./
COPY server/ ./server/

# Build client bundle and compile server script
RUN npm run build

# Remove development dependencies to keep output tiny
RUN npm prune --production

# --- STAGE 2: PRODUCTION ---
FROM node:22-alpine AS runner

WORKDIR /app

# Runtime library required by the native better-sqlite3 addon (compiled with g++).
RUN apk add --no-cache libstdc++

# Create a directory to store persistent data (database + backups)
RUN mkdir -p /app/data && chown -R node:node /app/data

# Dấu vân tay bản build — CI (release.yml) truyền semver từ tag + commit + giờ build;
# trang Phiên bản & Cập nhật dùng để so phiên bản. Build tay để trống → app lấy
# version trong package.json.
ARG APP_VERSION=
ARG GIT_SHA=
ARG BUILD_TIME=
ENV APP_VERSION=$APP_VERSION
ENV GIT_SHA=$GIT_SHA
ENV BUILD_TIME=$BUILD_TIME

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Copy necessary production files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Expose port 3000 (standard ingress port for container routing)
EXPOSE 3000

# Run container as non-root user for security
USER node

# Docker tự biết app còn sống không; dịch vụ cập nhật cũng dựa vào /api/health
# để xác nhận bản mới đã lên (sai → tự quay về bản cũ).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --start-interval=3s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/api/health" >/dev/null 2>&1 || exit 1

# Start full-stack system
CMD ["npm", "start"]
