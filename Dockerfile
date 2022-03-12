FROM node:17.7.1-alpine@sha256:6a016b0fd228faf31464ad7d12edf94fbd3fb5102f40c4cce3c0d2af0ee04800
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start