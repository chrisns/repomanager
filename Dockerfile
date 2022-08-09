FROM node:18.7.0-alpine@sha256:5ea44f2affe3439e54c44b19f1436f3105801ba79cac4982c05ee50562cd7600
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start