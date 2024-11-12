FROM node:22.11.0-alpine@sha256:25ba29777f040c42c68905650bc98f6441771c413042cda2c957b731056875b5
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start