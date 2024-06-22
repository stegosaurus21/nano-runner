FROM node:20.12.2 AS base

RUN apt-get install && apt-get update

FROM base AS builder

WORKDIR /app
COPY ./package.json ./
COPY ./package-lock.json ./

RUN npm ci

FROM base AS compilers

WORKDIR /compilers

COPY ./scripts/build .
RUN ./install_isolate.sh

COPY ./config/isolate.conf /usr/local/etc/isolate

FROM compilers AS app

WORKDIR /app

COPY --from=builder /app /app
COPY . .

ENTRYPOINT /app/scripts/init/entrypoint.sh
