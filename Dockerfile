FROM node:20.2.0-alpine@sha256:e3371ff11f576f13e497773b93410d982a00284c1a58e779d7234005105e44cc
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start