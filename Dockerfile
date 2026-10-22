FROM node:24.22.1-alpine@sha256:feb76650b7195319268c59cb2d419c732d6c499b13bf5296f16ab59eb1f0a4f3
WORKDIR /app
COPY . .

RUN npm install --omit=dev

USER node

CMD ["npm", "start"]
