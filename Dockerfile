# Jamiyati (جمعيتي) Backend Dockerfile
FROM node:20-bookworm-slim AS production

ENV NODE_ENV=production \
    PORT=4000 \
    DB_PATH=/app/src/database/jamiyati.sqlite \
    UPLOAD_DIR=/app/uploads/receipts

WORKDIR /app

# Install curl for container health check
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps || npm install --omit=dev

COPY . .

# Ensure database and upload directories exist
RUN mkdir -p /app/src/database /app/uploads/receipts

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

CMD ["node", "src/index.js"]
