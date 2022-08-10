FROM node:18.7.0-alpine@sha256:39eee9aa771257847d3d8bcb7f775439d0267197060053761b54021bcae6338e
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start