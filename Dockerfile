FROM node:20-alpine AS builder

WORKDIR /usr/src/app

COPY package*.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate

COPY . .
RUN npm run build

FROM node:20-alpine AS production

WORKDIR /usr/src/app

ENV NODE_ENV=production

COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/dist ./dist
COPY --from=builder /usr/src/app/prisma ./prisma
COPY --from=builder /usr/src/app/package.json ./package.json

USER node

EXPOSE 3001

CMD ["node", "dist/main.js"]
