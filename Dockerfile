FROM node:20.6.1-alpine@sha256:44170e5b4b2aff2be317ed62951b55fb63eb2b5dc49410a42f3ad961b7e7ed4b
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start