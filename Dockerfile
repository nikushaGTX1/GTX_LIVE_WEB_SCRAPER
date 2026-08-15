FROM mcr.microsoft.com/playwright:v1.62.0-noble

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "main.js"]
