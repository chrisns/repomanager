FROM node:24.22.1-alpine@sha256:eb37f58646a901dc7727cf448cae36daaefaba79de33b5058dab79aa4c04aefb
WORKDIR /app
COPY . .

RUN npm install --omit=dev

USER node

CMD ["npm", "start"]
