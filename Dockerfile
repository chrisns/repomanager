FROM node:20.3.0-alpine@sha256:30d5045fa5026abaed7439b62d51f73ac3efd1009496271d4c85fd83bb20144e
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start