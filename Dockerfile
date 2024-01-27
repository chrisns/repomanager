FROM node:21.6.0-alpine@sha256:a8beafd69068c05d09183e75b9aa679b520ba68f94b19c90d0da9f307f9f6565
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start