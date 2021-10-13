FROM node:16.11.1-alpine
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start