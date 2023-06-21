FROM node:20.3.1-alpine@sha256:6f764af2a706c458b2528bdc392270017203bf2c52005b083fe7855108f38e4e
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start