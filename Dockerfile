FROM node:22.11.0-alpine@sha256:f265794478aa0b1a23d85a492c8311ed795bc527c3fe7e43453b3c872dcd71a3
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start