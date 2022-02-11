FROM node:17.5.0-alpine@sha256:fe645e7b16fb7badef9f41278329717487f9428131d0e81f96669b1e2fa90b8b
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start