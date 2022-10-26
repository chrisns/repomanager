FROM node:19.0.0-alpine@sha256:7eaaf14ed8b7cc1d716b965bff7554d7d2e1127558ee8108d3844dc3a1122234
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start