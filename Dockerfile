FROM node:15.6.0-alpine
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start