FROM node:22.14.0-alpine@sha256:15dfca1d0af4f061a902e240d3b0012f4701aafcdf823d99525f2a73a12e6a4d
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start