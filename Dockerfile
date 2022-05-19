FROM node:18.2.0-alpine@sha256:0677e437543d10f6cb050d92c792a14e5eb84340e3d5b4c25a88baa723d8a4ae
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start