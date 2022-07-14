FROM node:18.6.0-alpine@sha256:b90b63a402958508763900643576333fbf560033191d4426da14b14f91e8d3b0
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start