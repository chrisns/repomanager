FROM node:20.3.0-alpine@sha256:9c92cf1a355d10af63a57d2c71034a6ba36a571d9a83be354c0422f1e7ef6cec
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start