FROM node:21.1.0-alpine@sha256:fbccd03f65ac1977852d8ab918e73be57153d0625fa4f4c0ef745261e464a64f
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start