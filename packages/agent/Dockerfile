# AgentCore Runtime image: arm64, listening on 0.0.0.0:8080 (HTTP protocol contract).
# The agent is pre-bundled by `pnpm --filter @quizapp/agent bundle`, so the image only
# copies one file; nothing runs under emulation when CI builds it on x86.
# Build from packages/agent:
#   docker buildx build --platform linux/arm64 -t quizapp-agent .

FROM --platform=linux/arm64 node:22-slim
WORKDIR /app
COPY dist-bundle/ ./
ENV NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps
EXPOSE 8080
USER node
CMD ["node", "index.mjs"]
