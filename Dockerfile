FROM node:17.4.0-alpine@sha256:6f8ae702a7609f6f18d81ac72998e5d6f5d0ace9a13b866318c76340c6d986b2
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start