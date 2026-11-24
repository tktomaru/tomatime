FROM node:24-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV TOMATIME_HOST=0.0.0.0
EXPOSE 3000
USER node
CMD ["node", "src/main.ts"]
