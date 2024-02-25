FROM node:21.6.2-alpine@sha256:65998e325b06014d4f1417a8a6afb1540d1ac66521cca76f2221a6953947f9ee
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start