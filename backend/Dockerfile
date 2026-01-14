FROM node:20-alpine

WORKDIR /app

# 1) Najpierw tylko package*.json żeby cache działał poprawnie
COPY package.json package-lock.json* ./

# 2) Zainstaluj zależności (w tym bcryptjs)
RUN npm ci --omit=dev || npm install --omit=dev

# 3) Potem dopiero reszta plików backendu
COPY . .

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "index.js"]
