FROM node:18.5.0-alpine@sha256:e479d86de1ef8403adda6800733a7f8d18df4f3c1c2e68ba3e2bc05fdea9de20
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start