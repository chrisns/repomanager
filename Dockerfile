FROM node:22.10.0-alpine@sha256:fc95a044b87e95507c60c1f8c829e5d98ddf46401034932499db370c494ef0ff
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start