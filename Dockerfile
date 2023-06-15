FROM node:20.3.0-alpine@sha256:622ff4c7c34afbaa1f63351c5d277f36e26b6395a33973e257f6d72f8230b48e
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start