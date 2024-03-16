FROM node:21.7.1-alpine@sha256:577f8eb599858005100d84ef3fb6bd6582c1b6b17877a393cdae4bfc9935f068
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start