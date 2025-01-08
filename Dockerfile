FROM node:22.13.0-alpine@sha256:fce322c9655fe5dc0aac3215bddf35d9907f1a6f59f990c1acace34a669eb86d
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start