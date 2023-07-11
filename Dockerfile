FROM node:20.4.0-alpine@sha256:8165161b6e06ec092cf5d02731e8559677644845567dbe41b814086defc8c261
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start