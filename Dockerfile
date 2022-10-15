FROM node:18.11.0-alpine@sha256:aea4be182415998853c47176eba665e862bed067ee6986632c20764782dcdf96
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start