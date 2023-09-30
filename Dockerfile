FROM node:20.8.0-alpine@sha256:37750e51d61bef92165b2e29a77da4277ba0777258446b7a9c99511f119db096
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start