FROM node:21.5.0-alpine@sha256:5d8335dc425d6c8d991a37e47dbd1e2581126038e287618bb16ca9ee6eb97d58
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start