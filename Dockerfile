FROM node:17.7.2-alpine@sha256:d211f6788222aac6a871bc0ada4b1e5e00c42c615d32b80b38548f04ebafd05a
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start