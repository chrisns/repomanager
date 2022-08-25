FROM node:18.8.0-alpine@sha256:a8409dff6597f2ef5f7ecd3c672671bb2af9a390073efd74f95c54aa41cba22a
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start