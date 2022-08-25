FROM node:18.8.0-alpine@sha256:d5d7d8e860cb38063ac0735753bed467d1360ece5ccb7c99747726bb9399ccfa
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start