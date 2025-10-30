FROM node:24.11.0-alpine@sha256:f36fed0b2129a8492535e2853c64fbdbd2d29dc1219ee3217023ca48aebd3787
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start