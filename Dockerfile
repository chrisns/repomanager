FROM node:18.6.0-alpine@sha256:b0ac9b10c96e8b8f980845f44836ca4617df513efabe39184527083f07f937ae
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start