FROM node:19.1.0-alpine@sha256:6c9b6a06142b5e91444350657d21747907ab8b84831d0ea18e6528e74524e532
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start