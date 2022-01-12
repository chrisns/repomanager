FROM node:17.3.1-alpine@sha256:7ef8e673a9ea7b1dfaae292bf8faf549bb81ba60f68087454cef143698bdf2c4
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start