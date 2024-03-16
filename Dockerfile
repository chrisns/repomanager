FROM node:21.7.1-alpine@sha256:92701a26dafc0e33c87fc245537b39af27da2be9736c84ed4f6f100c7d7194b0
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start