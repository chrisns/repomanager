FROM node:17.3.0-alpine@sha256:4dd690ef859ceadc242e9901fb554ce0a97a9055f33b9cf4ea441acdbfe50a34
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start