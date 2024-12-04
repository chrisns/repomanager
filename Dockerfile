FROM node:22.12.0-alpine@sha256:96cc8323e25c8cc6ddcb8b965e135cfd57846e8003ec0d7bcec16c5fd5f6d39f
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start