FROM node:21.4.0-alpine@sha256:34556ba78497768394c896cca78c490f620e624ddacd4ebe47380c52e3e5cf79
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start