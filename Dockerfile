FROM node:16.5.0-alpine
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start