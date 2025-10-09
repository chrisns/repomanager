FROM node:22.20.0-alpine@sha256:dbcedd8aeab47fbc0f4dd4bffa55b7c3c729a707875968d467aaaea42d6225af
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start