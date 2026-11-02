FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node index.mjs telegram.mjs ./
USER node
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["node", "index.mjs"]
