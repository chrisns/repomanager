FROM node:18.2.0-alpine@sha256:1d4fe66446508973e747fbc3cc86ca266c2a13510f6e8e9bb9f1a244dc984f18
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start