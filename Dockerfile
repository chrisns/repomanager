FROM node:18.3.0-alpine@sha256:36e8741b663ce72183be42d234833c02ab3e620f175cd3a720f37c9846a67245
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start