FROM node:20.8.0-alpine@sha256:54c374d45bd1479bdffac225b1bead49349ca1f86cd50d23a0b1d61b01659ae4
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start