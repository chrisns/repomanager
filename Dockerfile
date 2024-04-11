FROM node:21.7.3-alpine@sha256:0a50081b5723b3cfe2ef3a3c5675906b0bb942a4b8ede1f6ba5be6ec88413ec4
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start