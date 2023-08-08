FROM node:20.5.0-alpine@sha256:423dfd241dde92f10952be0d33dc3cea24015bfd85c8866050a83e2786535db0
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start