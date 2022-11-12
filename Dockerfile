FROM node:19.0.1-alpine@sha256:833b53a69ec9d6646967abe32d8550581824e3e46b1ca9fb565e95f02769a80d
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start