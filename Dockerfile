FROM node:21.7.2-alpine@sha256:6b840bf0506e8dfd3e3ce9e8c0cfb7c21333cdedabb25425b6ddc555d5df2442
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start