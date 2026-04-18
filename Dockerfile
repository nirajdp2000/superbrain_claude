FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY public ./public
COPY sdk ./sdk
COPY src ./src

EXPOSE 3210

CMD ["node", "src/server.mjs"]
