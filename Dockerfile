FROM node:22.11.0-alpine@sha256:1f74ba4dd0e0a5289c3ddab266f29b0197e9ec0d17d3ae08b3ca78adfe6d78fb
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start