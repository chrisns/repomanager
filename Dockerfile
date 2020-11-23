FROM node:15.2.1-alpine
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start