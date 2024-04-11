FROM node:21.7.3-alpine@sha256:6d0f18a1c67dc218c4af50c21256616286a53c09e500fadf025b6d342e1c90ae
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start