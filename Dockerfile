FROM node:18.8.0-alpine@sha256:f8038a951b061017a7f5d136677b8fb115f6ece90e0abc23dc244142c9cef7fe
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start