FROM node:21.6.0-alpine@sha256:2a36d0555fc8549605075459c51915fb5c3414e221304cdb346f7725e25c2217
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start