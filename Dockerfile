FROM node:20.6.0-alpine@sha256:c843f4a4060246a25f62c80b3d4cf4a6b4c4639cdce421e4f2ee3102257225b4
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start