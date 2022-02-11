FROM node:17.5.0-alpine@sha256:f92a681e661a686ca5c07d2a5b415784ce9fb6350a0a589ad7546bbac51a3b78
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start