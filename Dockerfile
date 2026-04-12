FROM node:22.22.2-alpine@sha256:4d64b49e6c891c8fc821007cb1cdc6c0db7773110ac2c34bf2e6960adef62ed3
WORKDIR /app
COPY . .

RUN npm install --omit=dev

USER node

CMD ["npm", "start"]
