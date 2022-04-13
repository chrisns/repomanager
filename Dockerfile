FROM node:17.9.0-alpine@sha256:f61706c2cb120c06cf4fdcf60a2822a804b0bd90b6b2209be1ee00db1d33130c
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start