FROM node:18.3.0-alpine@sha256:ab9bd2f8d994fd86275b4999d12826c668a639020b4b0151ea9b7db575f8ee45
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start