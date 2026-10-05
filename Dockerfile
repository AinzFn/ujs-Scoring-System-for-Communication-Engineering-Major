FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY public ./public
RUN mkdir -p /app/data
ENV HOST=0.0.0.0 PORT=3000 DATA_FILE=/app/data/score-data.json
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "server.mjs"]
