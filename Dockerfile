FROM node:21.7.3-alpine@sha256:1ff8fa26672292bf3bca33706cc3e9d7262468e325a01930d3812d0422cc02cd
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start