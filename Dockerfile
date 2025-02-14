FROM node:22.14.0-alpine@sha256:f96abbefa5558bcf3a309a5da9e1e9bd6dece7704b895c1213ca62f245061d3f
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start