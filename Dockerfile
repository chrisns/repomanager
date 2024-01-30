FROM node:21.6.1-alpine@sha256:68779561b3347e05dd02db6bb0365c5a9387abdb4522e368eedc8ae3b3111d1f
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start