FROM node:19.7.0-alpine@sha256:d3a3d691797cef0b70e361788a2aeb9dd7925112996719628d4bcd4bd27009b0
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start