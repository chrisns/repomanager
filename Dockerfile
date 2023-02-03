FROM node:19.6.0-alpine@sha256:72b0f918ad76b5ef68c6243869fab5800d7393c1dcccf54ef00958c2abc8164a
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start