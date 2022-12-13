FROM node:19.2.0-alpine@sha256:2770c782de28bf078850d4b53afc46befa4c229f2c65564d0123d604e6aac1a9
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start