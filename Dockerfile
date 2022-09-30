FROM node:18.10.0-alpine@sha256:304e707e9283ac64af3bae2a8d6b8b16dfe00d91f739d80015bd0b74147c6840
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start