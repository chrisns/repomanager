FROM node:21.7.3-alpine@sha256:db8772d9f5796ac4e8c47508038c413ea1478da010568a2e48672f19a8b80cd2
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start