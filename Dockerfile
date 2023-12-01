FROM node:21.2.0-alpine@sha256:14050fee3f55a38841a4e321d8c6f702bdd1de707865c9c95b1f4e3513eee9de
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start