FROM node:21.6.1-alpine@sha256:4cc2d9f365691fc6f8fe227321d32d9a2691216a71f51c21c7f02224515dea48
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start