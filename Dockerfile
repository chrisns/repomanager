FROM node:21.7.1-alpine@sha256:bac812a020b920e32f6b5a8656e0e835efab70791855df8b94e2ffa0652b3bd9
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start