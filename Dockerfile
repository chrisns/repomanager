FROM node:22.11.0-alpine
WORKDIR /app
COPY . .

RUN npm install --omit=dev

USER node

CMD ["npm", "start"]
