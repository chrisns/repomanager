FROM node:20.2.0-alpine@sha256:95216821bade21577d120a1d3bd2409a4b857cb84e674993b4323b9c3c90f635
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start