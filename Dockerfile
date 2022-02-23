FROM node:17.6.0-alpine@sha256:2e38139d3e3971dad16eddaa1d0d215029ddda97c569a200a8eaef4b911649e3
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start