FROM node:20-alpine
WORKDIR /app
COPY server/package.json ./package.json
RUN npm install --omit=dev
COPY server/src ./src
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "src/index.js"]
