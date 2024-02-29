FROM node:21.6.2-alpine@sha256:d3271e4bd89eec4d97087060fd4db0c238d9d22fcfad090a73fa9b5128699888
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start