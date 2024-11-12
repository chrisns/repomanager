FROM node:22.11.0-alpine@sha256:dc8ba2f61dd86c44e43eb25a7812ad03c5b1b224a19fc6f77e1eb9e5669f0b82
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start