FROM node:20.6.1-alpine@sha256:d75175d449921d06250afd87d51f39a74fc174789fa3c50eba0d3b18369cc749
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start