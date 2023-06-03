FROM node:20.2.0-alpine@sha256:f3fe00fbf0cd0660487f3133a2a4bf16d0778198fdc94a08eb6558ebf9c39f57
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start