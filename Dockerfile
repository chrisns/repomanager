FROM node:20.3.1-alpine@sha256:6addfee84c8099cbf265443cad15f4b321854e0f3c4ea43e2f042f2bf55bd8b2
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start