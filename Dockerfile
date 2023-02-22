FROM node:19.7.0-alpine@sha256:dec5b7b8003f9bb372ceb6744f9067ca493ea0ff562ca836359248ae467a1c1e
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start