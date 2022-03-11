FROM node:17.7.1-alpine@sha256:dc8b656211740222bcc3a5c90fa6ba5e545f779660c67f5d3f155ff946d05aaa
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start