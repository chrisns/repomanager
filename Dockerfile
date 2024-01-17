FROM node:21.6.0-alpine@sha256:db1379003aed528d7d7117f3762039ad20538fff3933c9d34de19c261b589975
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start