FROM node:20.3.0-alpine@sha256:e6f3bab50ea4b1b0e3548f76cccc6ef8e30268fb50a20683331fd245ed17e0e1
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start