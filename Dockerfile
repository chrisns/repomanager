FROM node:22.21.0-alpine@sha256:b410676781397cabae22f81547ddb3e6b975dc04b43626098ce17ea53a447ef1
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start