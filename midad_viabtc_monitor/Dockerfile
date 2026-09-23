FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.mjs ./
COPY adapter ./adapter

ENV NODE_ENV=production
ENV HOST=127.0.0.1
ENV PORT=8787

USER node

EXPOSE 8787

CMD ["node", "server.mjs"]
