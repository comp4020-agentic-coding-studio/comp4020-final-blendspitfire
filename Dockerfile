# syntax = docker/dockerfile:1

# Builder: full deps (esbuild, typescript, three's types) just to produce the
# client bundle. None of this ships in the runtime image.
FROM node:24-alpine AS build
WORKDIR /app
RUN npm install -g pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY client ./client
COPY shared ./shared
COPY scripts/build-client.ts ./scripts/build-client.ts
COPY public ./public
RUN node scripts/build-client.ts

# Runtime: only what the server needs to actually run --- `ws` on top of
# Node's own http/sqlite --- plus the already-built client bundle.
FROM node:24-alpine
WORKDIR /app
RUN npm install -g pnpm@11.9.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY server ./server
COPY shared ./shared
COPY README.md ./README.md
COPY --from=build /app/public ./public

ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server/index.ts"]
