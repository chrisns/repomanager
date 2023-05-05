FROM node:20.1.0-alpine@sha256:b23cdb83c5822346141b0dd6f5734b01c0fbe68ab9cc5ac8c1672be9ec198d5b
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start