FROM node:17.7.1-alpine@sha256:d1d5dc5de1501601c6f5a1bcac25b5d2060f9127663ac41273a6abfcaa68569b
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start