FROM node:21.1.0-alpine@sha256:6d5e1248103df20a970e53bf4090c0651426b45a7b7cd53afbfc4eee637c7abf
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start