FROM node:20.8.1-alpine@sha256:7c3f00204a4971196449ac5bb3777c6128a48697dee2a8218405b1ecc02334b0
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start