FROM node:22.14.0-alpine@sha256:b42a92920f68e2dd8f7f03b3f982a09f68221081cf04ca34b275c6b14ed9dfbd
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start