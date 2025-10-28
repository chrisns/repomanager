FROM node:24.10.0-alpine@sha256:775ba24d35a13e74dedce1d2af4ad510337b68d8e22be89e0ce2ccc299329083
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start