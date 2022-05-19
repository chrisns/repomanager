FROM node:18.2.0-alpine@sha256:fdfc82ce58261aa34d0d28554fea0ef2492f8be272975ce4b5f18d0a4d8c6999
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start