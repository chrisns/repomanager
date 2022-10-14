FROM node:18.11.0-alpine@sha256:d1e09ed04f228ed68024460e77b777c24025b39d6ee426308aa703fe5282a18d
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start