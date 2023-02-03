FROM node:19.6.0-alpine@sha256:3b707b18bf865b1c66150bac5cc3f51af30a6dedb32f21cde94b18fcbe9a752f
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start