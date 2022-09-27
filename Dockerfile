FROM node:18.9.1-alpine@sha256:449139de1290831c25998282196d386db979088f4c7597d31f007d5b04b95464
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start