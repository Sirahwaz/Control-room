FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.mjs ./

ENV NODE_ENV=production
ENV HOST=127.0.0.1
ENV PORT=8788

USER node

EXPOSE 8788

CMD ["node", "server.mjs"]
