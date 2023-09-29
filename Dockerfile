FROM node:20.7.0-alpine@sha256:a0c796fbeda2e4370923ab5e64ed3351b072dc655b2e504f7204f60b1abd72dd
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start