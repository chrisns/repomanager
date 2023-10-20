FROM node:21.0.0-alpine@sha256:e2df5e4be3793165cddd8ed1407e8b83c40214bb3edb65485e07c9aff2e53ecc
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start