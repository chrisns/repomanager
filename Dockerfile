FROM node:19.7.0-alpine@sha256:667dc6ed8fc6623ccd21cb5fa355c90f848daaf5d6df96bc940869bfdf91c19a
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start