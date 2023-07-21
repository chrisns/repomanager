FROM node:20.5.0-alpine@sha256:d0b7a0bb4d1f3d4f49988541caebcfa4408892288e93097e4b89c92131163234
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start