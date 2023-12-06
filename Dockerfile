FROM node:21.4.0-alpine@sha256:c90ade35fba86098b07be6b51e4a85946ce4f73321184c35791a8025862e9b20
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start