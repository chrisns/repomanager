FROM node:18.5.0-alpine@sha256:d50bd5d10bcfce059c0ca61929c73d82d30dbea07dff9c5bea31774f370f0619
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start