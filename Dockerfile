FROM node:19.0.1-alpine@sha256:2241dcb089d4d46d9321cc69f67769f741a04b08c9ead1530e8054d7eaac97a5
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start