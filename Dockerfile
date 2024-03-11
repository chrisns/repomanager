FROM node:21.7.1-alpine@sha256:de706bf744e9f58265d7ad467c3be0971e5f7c36d2417fd6b5491f6c682ccbed
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start