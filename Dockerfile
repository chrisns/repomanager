FROM node:21.7.0-alpine@sha256:7bfef1d72befbb72b0894a3e4503edbdc0441058b4d091325143338cbf54cff8
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start