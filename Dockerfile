FROM node:19.4.0-alpine@sha256:a46127e99de2879d3268c6b62e6a8eaea7922ed72b56fc0e9b755539127567ab
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start