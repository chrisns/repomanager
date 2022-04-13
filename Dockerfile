FROM node:17.9.0-alpine@sha256:57bbb2b83b8cfee7428928fd4873df42009c50dc2262f81f5046ebb838cb31f5
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start