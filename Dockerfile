FROM node:22.19.0-alpine@sha256:d2166de198f26e17e5a442f537754dd616ab069c47cc57b889310a717e0abbf9
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start