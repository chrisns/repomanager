FROM node:20.3.1-alpine@sha256:f77f29bc47124b393d8e7ae947be385e851d7c448d85ab87a4c077af84ee8ea2
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start