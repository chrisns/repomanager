FROM node:22.17.0-alpine@sha256:5340cbfc2df14331ab021555fdd9f83f072ce811488e705b0e736b11adeec4bb
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start