FROM node:21.3.0-alpine@sha256:5a3d8369ca6e9cefeaaaa5150224b943de33833f1bb37570ccf96f0c3433f5d5
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start