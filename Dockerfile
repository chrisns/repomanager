FROM node:22.21.0-alpine@sha256:bd26af08779f746650d95a2e4d653b0fd3c8030c44284b6b98d701c9b5eb66b9
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start