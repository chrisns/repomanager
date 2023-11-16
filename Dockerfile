FROM node:21.2.0-alpine@sha256:4607c16b76881564ef54678cbe36837af8a13a9c3a023c5cfe3dbe2c4ebfae99
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start