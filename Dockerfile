FROM node:18.3.0-alpine@sha256:de088ce2f79c955fcbcb4b6e43d8084ea842af970fa8928d6ce9f10a942952f3
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start