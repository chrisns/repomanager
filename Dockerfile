FROM node:21.2.0-alpine@sha256:4a512d1538b1a8281b58cab0b366a5c62436566bb63e7dcd4a6769c98edb3b5f
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start