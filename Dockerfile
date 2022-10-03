FROM node:18.10.0-alpine@sha256:d4935e4a77d3a9aca897dc3610f7a9abc83732ba4075439fbdb46a517c07d81e
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start