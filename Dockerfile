FROM node:20.5.0-alpine@sha256:efcfc9e818c3abe166cfcced1c9602cac29e08c83b273a4f280a87d4218daf8c
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start