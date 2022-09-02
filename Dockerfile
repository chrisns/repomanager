FROM node:18.8.0-alpine@sha256:8437bc872a71f3b15a384ff32d098a68e06b440c0d9ec3eb4b4fa26ca16f2b30
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start