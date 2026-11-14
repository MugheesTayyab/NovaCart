# Build from the repository root:  docker build -f web/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /srv/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
# The site reads ../policies at build time.
COPY policies /srv/policies
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /srv/web
COPY --from=build /srv/web ./
COPY --from=build /srv/policies /srv/policies
EXPOSE 3000
CMD ["npm", "start"]
