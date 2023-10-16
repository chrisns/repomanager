FROM node:20.8.1-alpine@sha256:a369136b6f7640f85acf300ce9d6498d8161972b855a72bbc79273150d4dd0c7
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start