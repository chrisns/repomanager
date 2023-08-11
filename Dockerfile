FROM node:20.5.1-alpine@sha256:5fd1bdbbb0d96d68c65a5c18a70ff9819ff1dc2889ac4c390bad4f79834c7bb3
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start