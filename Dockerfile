FROM node:21.7.3-alpine@sha256:78c45726ea205bbe2f23889470f03b46ac988d14b6d813d095e2e9909f586f93
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start