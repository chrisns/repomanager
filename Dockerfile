FROM node:21.6.0-alpine@sha256:abf44a632a4ef1a63f8a10d91b3628203bde887851666c4ddcfa45b751e83ae1
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start