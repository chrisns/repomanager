FROM node:24.14.0-alpine@sha256:ffc7bb66190e1732398a70a4642a4e173762c10ed88fdca320a8e2fcc41e5ff2
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start