FROM node:22-slim

RUN npm install -g @openai/codex \
 && mkdir -p /work /home/node/.codex \
 && chown -R node:node /work /home/node/.codex

WORKDIR /app
COPY server.mjs ./

USER node
ENV NODE_ENV=production \
    CODEX_HOME=/home/node/.codex \
    RUNNER_WORKDIR=/work

EXPOSE 8080
CMD ["node", "/app/server.mjs"]
