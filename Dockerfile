FROM node:19.7.0-alpine@sha256:4a3a2ccfa801ce6960e7fc29fc5e5a1ed896b633e4731cdb87b4e1a1e9ad246e
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start