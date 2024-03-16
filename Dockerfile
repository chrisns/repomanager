FROM node:21.7.1-alpine@sha256:a49328f68b1f0782ef6293369aab9e46b4a2fb7f8b338955916f8bede3e350c6
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start