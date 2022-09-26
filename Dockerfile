FROM node:18.9.1-alpine@sha256:0b1ab37a6ef65ea6a623c1d9d4c65757dfc267ffcfee6a221d6c3c2169d6b16b
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start