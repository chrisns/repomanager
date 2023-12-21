FROM node:21.5.0-alpine@sha256:82c93cef3d2acbb2557c5fda48214fbc2bf5385edfb4d96d990690d75ddabf7b
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start