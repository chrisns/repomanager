FROM node:22.20.0-alpine@sha256:cb3143549582cc5f74f26f0992cdef4a422b22128cb517f94173a5f910fa4ee7
WORKDIR /app
COPY . .

RUN npm install --production

USER node

CMD npm start