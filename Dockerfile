FROM node:24.13.0-alpine@sha256:cd6fb7efa6490f039f3471a189214d5f548c11df1ff9e5b181aa49e22c14383e
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start