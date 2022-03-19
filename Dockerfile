FROM node:17.7.2-alpine@sha256:1ef397a038d809785a1f787de87fbb496d10ee1b0565068289da1c5cac0d1fe4
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start