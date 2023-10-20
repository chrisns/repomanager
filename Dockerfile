FROM node:21.0.0-alpine@sha256:39bf945d56c29e7b3fa51632a7a07080475e5d5e5fc981543cdb735bc3bc01eb
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start