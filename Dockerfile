FROM node:22.17.1-alpine@sha256:1aac89e91a868bb8ef47bf0de29115acf0857e88d9d549779ef4ab778decef1f
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start