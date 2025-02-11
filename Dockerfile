FROM node:22.13.1-alpine@sha256:e2b39f7b64281324929257d0f8004fb6cb4bf0fdfb9aa8cedb235a766aec31da
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start