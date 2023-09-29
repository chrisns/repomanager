FROM node:20.7.0-alpine@sha256:a348d50e74df20fa8c572c3abf80b89ae4daf9c312523c49a42997284d13ebac
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start