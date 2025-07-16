FROM node:22.17.0-alpine@sha256:0f2b9a8d6a7c915b006beeaf41c5675a3e92d7ba548bb9a42263a3cac1e15867
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start