FROM node:21.7.2-alpine@sha256:ad255c65652e8e99ce0b9d9fc52eee3eae85f445b192f6f9e49a1305c77b2ba6
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start