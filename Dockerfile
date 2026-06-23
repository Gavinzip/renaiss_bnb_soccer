# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npm run build

FROM node:22-alpine AS runtime-deps
WORKDIR /app
RUN apk add --no-cache ca-certificates python3 make g++
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts=false \
  && npm rebuild better-sqlite3 --foreground-scripts \
  && test -f node_modules/better-sqlite3/build/Release/better_sqlite3.node \
  && npm cache clean --force

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache ca-certificates git

COPY package*.json ./
COPY --from=runtime-deps /app/node_modules ./node_modules

COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src/app/data/worldCupCampaign.js ./src/app/data/worldCupCampaign.js

EXPOSE 3000
CMD ["npm", "start"]
