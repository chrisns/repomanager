FROM node:20.3.0-alpine@sha256:7813cb0247bba6e4268b26607a0002c4843956bbca684d67da47b153e811ae8b
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start