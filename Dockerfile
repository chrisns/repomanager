FROM node:18.0.0-alpine@sha256:1e51561b49be84676669cdc824069546171ed0a6a00eb0ee4a56d490fb8743a8
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start