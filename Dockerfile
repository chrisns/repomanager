FROM node:20.7.0-alpine@sha256:ebb6b2bb56c442e8065558d87b35a04aa7a759cc456dbe6efb60d4541d06fec8
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start