FROM node:20-alpine
# font-dejavu: resvg needs a system font or raster text (PNG/PDF tag export) renders blank on Alpine
RUN apk add --no-cache font-dejavu fontconfig
WORKDIR /app
COPY package*.json ./
# npm install (not ci) so @resvg/resvg-js resolves its linux-musl optional binary for this arch
RUN npm install --omit=dev
COPY . .
EXPOSE 8080
CMD ["sh", "-c", "node src/migrate.js && node src/server.js"]
