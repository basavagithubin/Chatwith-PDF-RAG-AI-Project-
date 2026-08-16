FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache libc6-compat \
  && addgroup -S pdfchat \
  && adduser -S pdfchat -G pdfchat
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
RUN mkdir -p /app/storage/documents /app/storage/tmp \
  && chown -R pdfchat:pdfchat /app
USER pdfchat
ENV NODE_ENV=production
ENV CONTAINER=1
ENV LOCAL_STORAGE_PATH=/app/storage
EXPOSE 5000
HEALTHCHECK --interval=20s --timeout=5s --start-period=25s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:5000/health/live').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
