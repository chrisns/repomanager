FROM node:21.7.1-alpine@sha256:4999fa1391e09259e71845d3d0e9ddfe5f51ab30253c8b490c633f710c7446a0
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start