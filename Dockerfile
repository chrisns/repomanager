FROM node:20.7.0-alpine@sha256:a329b146bcc99a36caa73056e60714d0911ca5c229ade3eb27e9283dc78c9eb6
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start