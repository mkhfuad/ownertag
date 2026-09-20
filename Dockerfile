FROM node:20-alpine
# font-dejavu: resvg needs a system font or raster text (PNG/PDF tag export) renders blank on Alpine
RUN apk add --no-cache font-dejavu fontconfig
WORKDIR /app
COPY package*.json ./
# npm install (not ci) so @resvg/resvg-js resolves its linux-musl optional binary for this arch
RUN npm install --omit=dev
COPY . .
# ponytail: drop root at runtime. node:alpine ships a 'node' user (uid 1000);
# node_modules is world-readable and the app only reads from /app, so USER node alone works.
USER node
EXPOSE 8080
CMD ["sh", "-c", "node src/migrate.js && node src/server.js"]
