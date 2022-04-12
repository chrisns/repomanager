FROM node:17.9.0-alpine@sha256:e7930abb2b33c8c7fa1a6dd1addd40cb26104c80f2e2a5d59d480aa2843bbed1
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start