FROM node:18.9.0-alpine@sha256:831d5eca5b7437a8132031a25bd18bdb0399e7415d4e8e02a8c14426b6dcf17f
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start