FROM node:21.5.0-alpine@sha256:b6f9e9c608cd55a96f9725c114d50aa4167fb59002c7c05335d04c6ad729dd21
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start