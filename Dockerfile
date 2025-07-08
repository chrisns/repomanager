FROM node:22.17.0-alpine@sha256:10962e8568729b0cfd506170c5a2d1918a2c10ac08c0e6900180b4bac061adc9
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start