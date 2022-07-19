FROM node:18.6.0-alpine@sha256:a1c01a01ecb29c6a8bdfdcd49a887a01efa482334fcd87a3dc9e5bc89fcf74b4
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start