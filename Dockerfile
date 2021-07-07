FROM node:16.4.2-alpine
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start