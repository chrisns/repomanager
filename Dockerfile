FROM node:19.2.0-alpine@sha256:642285d9083c1555bf440a3a60b2c5251f54ea8d8a31c5b1bc44bf81895d072b
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start