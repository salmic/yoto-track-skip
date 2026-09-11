FROM node:22-alpine AS build

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json ./
COPY web/package.json web/package-lock.json ./web/
COPY scripts ./scripts

RUN npm ci && npm ci --prefix web

COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY web ./web

RUN npm run build

FROM node:22-alpine AS production

RUN apk add --no-cache python3 make g++

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV DATA_DIR=/data

COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist

RUN mkdir -p /data

EXPOSE 3847

CMD ["node", "dist/index.js"]
