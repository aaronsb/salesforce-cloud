# Build stage
FROM node:24-slim AS builder
WORKDIR /app

# Add metadata
LABEL org.opencontainers.image.source="https://github.com/aaronsb/salesforce-cloud"
LABEL org.opencontainers.image.description="Salesforce Cloud MCP Server"
LABEL org.opencontainers.image.licenses="MIT"

# Copy source files
COPY . .

# Install dependencies and build
RUN npm ci && \
    npm cache clean --force && \
    npm run build

# Production stage
FROM node:24-slim
WORKDIR /app

# Set docker hash as environment variable
ARG DOCKER_HASH=unknown
ENV DOCKER_HASH=$DOCKER_HASH

# Create necessary directories with proper permissions
RUN mkdir -p /app/logs /app/config && \
    chown -R 1000:1000 /app && \
    chmod 750 /app/logs /app/config

# Copy only necessary files from builder
COPY --from=builder /app/build ./build
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/docker-entrypoint.sh ./

# Install production dependencies only
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force && \
    chmod +x build/index.js && \
    chmod +x docker-entrypoint.sh

# Switch to host user's UID
USER 1000

ENTRYPOINT ["./docker-entrypoint.sh"]
