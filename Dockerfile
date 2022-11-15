FROM node:19.1.0-alpine@sha256:c59fb39150e4a7ae14dfd42d3f9874398c7941784b73049c2d274115f00d36c8
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start