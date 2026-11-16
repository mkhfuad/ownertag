FROM node:20-alpine
# font-dejavu: resvg needs a system font or raster text (PNG/PDF tag export) renders blank on Alpine
RUN apk add --no-cache font-dejavu fontconfig
WORKDIR /app
COPY package*.json ./
# npm ci: reproducible build from package-lock.json (the lock lists the linux-musl @resvg binary)
RUN npm ci --omit=dev
COPY . .
# ponytail: drop root at runtime. node:alpine ships a 'node' user (uid 1000);
# node_modules is world-readable and the app only reads from /app, so USER node alone works.
USER node
EXPOSE 8080
# exec: node becomes PID 1 and receives SIGTERM, so deploys stop cleanly instead of waiting for a hard kill
CMD ["sh", "-c", "node src/migrate.js && exec node src/server.js"]
