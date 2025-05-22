FROM node:22.16.0-alpine@sha256:9f3ae04faa4d2188825803bf890792f33cc39033c9241fc6bb201149470436ca
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start