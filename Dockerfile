FROM node:21.6.2-alpine@sha256:24fedbed11428df96754e1f5807697a5affd7914b930aae049dfb74358d4fb78
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start