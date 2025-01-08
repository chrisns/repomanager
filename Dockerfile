FROM node:22.13.0-alpine@sha256:bbe9b971cb51593d8a4b8aa81ab031f2b3f3a6344d4fb297335a5fb058ad8c46
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start