FROM node:21.7.2-alpine@sha256:c4679fe0dc0434d1c002d0a453a8b09a397d93e44c6c12dd1ec7affa3891422d
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start