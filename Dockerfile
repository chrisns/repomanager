FROM node:22.16.0-alpine@sha256:fa5f57793a2553cd6d40ef234d8f51c4c1df73284f14acf877e36bb7801d257c
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start