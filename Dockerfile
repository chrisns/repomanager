FROM node:24.12.0-alpine@sha256:7e0bd0460b26eb3854ea5b99b887a6a14d665d14cae694b78ae2936d14b2befb
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start