FROM node:20-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY build.js .
COPY src ./src
COPY USER-GUIDE.md SYSTEMS-INTEGRATOR-GUIDE.md ./
RUN mkdir -p dist && node build.js

FROM nginx:alpine
COPY --from=build /src/dist/index.html /usr/share/nginx/html/index.html
# dist/help/ is a pre-built, committed static site (build-help-site.js, run manually — see its own
# header comment for why it isn't part of the "build" stage above) — copied straight from the outer
# build context, not the Node build stage, since it needs no compilation and the Node stage never
# produces it.
COPY dist/help /usr/share/nginx/html/help
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
# Security review finding M8: deliberately NOT switching to a non-root USER here — this listens on
# port 80 (privileged, <1024), which a non-root user can't bind without extra capabilities, and
# nginx's own worker processes (the ones actually handling requests) already drop privilege
# internally to the "nginx" user by default; only the master process stays root, matching upstream
# nginx's own documented, intentional design.
