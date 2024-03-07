FROM node:21.7.0-alpine@sha256:1c0093c1a17c4be3e2446131792f8306790a76c6d1f2ec756b87b2ff03f6c51b
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start