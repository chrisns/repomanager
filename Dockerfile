FROM node:22.17.0-alpine@sha256:fc3e945f920b7e3000cd1af86c4ae406ec70c72f328b667baf0f3a8910d69eed
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start