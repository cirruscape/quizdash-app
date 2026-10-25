# AgentCore Runtime requires an arm64 image listening on port 8080.
# Build from the repo root:
#   docker buildx build --platform linux/arm64 -f packages/agent/Dockerfile -t quizapp-agent .

FROM --platform=linux/arm64 node:22-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @quizapp/agent... build \
 && pnpm --filter @quizapp/agent deploy --prod /out

FROM --platform=linux/arm64 node:22-slim
WORKDIR /app
COPY --from=build /out .
ENV NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node", "dist/server.js"]
