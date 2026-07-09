FROM node:20-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY build.js .
COPY src ./src
RUN mkdir -p dist && node build.js

FROM nginx:alpine
COPY --from=build /src/dist/index.html /usr/share/nginx/html/index.html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
