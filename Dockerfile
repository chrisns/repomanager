FROM node:20.2.0-alpine@sha256:59ac6536ba03469adc3847f23a4f223b0418fba21c90168d703f61bd84125989
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start