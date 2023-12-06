FROM node:21.4.0-alpine@sha256:9bfaec4816d320226b1533abd5d22d6a888105ee502b820676736de99a198408
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start