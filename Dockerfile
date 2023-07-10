FROM node:20.4.0-alpine@sha256:d8dc54c9899bdf2f62a915bbdef09b15b879dc53109fe16d9987f6e543f18fdd
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start