FROM node:21.2.0-alpine@sha256:5fc1d095e47286b0859342a7b8a90b1c3adf2c283f12c6542a5456c1f2955218
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start