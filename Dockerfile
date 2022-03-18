FROM node:17.7.2-alpine@sha256:c802620ae8ab268a94629654352f40c99962ed2ae71bef51d14efc21faf703af
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start