FROM node:20.5.0-alpine@sha256:59ecf4c430fc6e15b3e6f2ee3ae8fa9773b2508856baf376fcd9ad7b1e6934a9
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start