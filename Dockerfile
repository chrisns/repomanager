FROM node:17.3.1-alpine@sha256:7653cfe1253703d99d6d0760b17b3f57e9553aa1a8d2efff6be90eb542a4328a
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start