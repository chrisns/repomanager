FROM node:22.12.0-alpine@sha256:51eff88af6dff26f59316b6e356188ffa2c422bd3c3b76f2556a2e7e89d080bd
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start