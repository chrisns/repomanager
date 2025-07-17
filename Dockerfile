FROM node:22.17.1-alpine@sha256:5539840ce9d013fa13e3b9814c9353024be7ac75aca5db6d039504a56c04ea59
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start