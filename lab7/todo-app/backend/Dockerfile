FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
# --omit=dev пропускает devDependencies, но сохраняет optionalDependencies (opentelemetry)
RUN npm ci --omit=dev

COPY server.js ./

EXPOSE 5000

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:5000/api/health || exit 1

CMD ["node", "server.js"]
