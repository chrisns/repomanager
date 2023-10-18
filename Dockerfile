FROM node:20.8.1-alpine@sha256:002b6ee25b63b81dc4e47c9378ffe20915c3fa0e98e834c46584438468b1d0b5
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start