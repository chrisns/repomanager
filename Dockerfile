FROM node:21.6.0-alpine@sha256:ab620cffd0f4d4529ef97682b2309c0571cd14a75496aa0934a13b059d003647
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start