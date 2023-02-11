FROM node:19.6.0-alpine@sha256:05415739dd8d92904a7e5bcb5e7305aff5d9889ec1f28ed703687b7bf649a323
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start