FROM node:21.6.2-alpine@sha256:6c07ba2830acba951b73d9eec82782f5a7bb805092277d6241ff8a3615b0f9bd
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start