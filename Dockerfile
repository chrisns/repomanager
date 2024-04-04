FROM node:21.7.2-alpine@sha256:530e67fa4197af700b9f5da6715352b698aae183b086532e4d800ea5f61496c9
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start