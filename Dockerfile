FROM node:19.8.1-alpine@sha256:bdcdb5aec334a9115d6fd2caaf72782fbb0f4f2e14611b255fa07400ab0d71f6
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start