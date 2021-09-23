FROM node:16.10.0-alpine
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start