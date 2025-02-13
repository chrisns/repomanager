FROM node:22.14.0-alpine@sha256:f93d93d31e202006196d5d22babb9bec7615b9a101744717df815d3d87e275f8
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start