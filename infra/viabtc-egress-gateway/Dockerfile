FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY server.mjs /app/server.mjs

RUN chown -R node:node /app
USER node

EXPOSE 8080

CMD ["node", "/app/server.mjs"]