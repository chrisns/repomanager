FROM node:20.1.0-alpine@sha256:eb37f58646a901dc7727cf448cae36daaefaba79de33b5058dab79aa4c04aefb
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start