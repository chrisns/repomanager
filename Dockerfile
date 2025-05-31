FROM node:22.16.0-alpine@sha256:d0baf824e0a29bc98d01988ba32505cf58dc09ccb90cace4e067a8001611262f
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start