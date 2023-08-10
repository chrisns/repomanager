FROM node:20.5.1-alpine@sha256:944abeb6cd93b39801b2dc24cf62fa39662712e992769a9c782ea391ef7dd8b2
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start