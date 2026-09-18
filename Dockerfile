FROM node:24.21.0-alpine@sha256:4b2d7eef36889f0aec0d58d1b19778321176c67824b7c951352d86c5c7811d44
WORKDIR /app
COPY . .

RUN npm install --omit=dev

USER node

CMD ["npm", "start"]
