FROM node:19.5.0-alpine@sha256:4619ec6c9a43ab4edfa12cf96745319c3ca43aff9dd630ab20e684dd3632318e
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start