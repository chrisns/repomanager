FROM node:18.4.0-alpine@sha256:62833d1958dc78b3912ac3de6aa3a5d787f7a7bbbe6a950676b4ac777762da5c
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start