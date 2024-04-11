FROM node:21.7.3-alpine@sha256:0230cbfd45a088c3b31c039e7ad05ddbbac30a29fd1b72e6fea29db74782dfa1
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start