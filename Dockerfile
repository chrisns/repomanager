FROM node:20.6.0-alpine@sha256:565fa6c73434f4410cb48d25384f24807e8a3fbf2de3e6bda4fdbad31c4dce13
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start