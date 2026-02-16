FROM node:24.13.1-alpine@sha256:4f696fbf39f383c1e486030ba6b289a5d9af541642fc78ab197e584a113b9c03
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start