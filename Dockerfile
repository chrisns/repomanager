FROM node:26.13.1-alpine@sha256:f56092a5d85c32beef14de944aaa0110193ef1ae85205036c5d40d8aece58759
WORKDIR /app
COPY . .

RUN npm install --omit=dev

USER node

CMD ["npm", "start"]
