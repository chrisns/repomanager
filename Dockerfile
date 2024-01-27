FROM node:21.6.0-alpine@sha256:cd5cb604273b8727a7dd7e3ff626647106ef7f930002a819f602cee6a7938b83
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start