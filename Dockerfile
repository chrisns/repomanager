FROM node:16.6.1-alpine
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start