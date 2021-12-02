FROM node:17.2.0-alpine
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start