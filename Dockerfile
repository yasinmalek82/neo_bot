FROM node:24-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
COPY tools ./tools
COPY docs ./docs
COPY AGENTS.md PROJECT_CONTEXT.md README.md SECURITY.md ./
COPY .dependency-cruiser.cjs eslint.config.mjs knip.json .prettierrc.json .prettierignore ./
RUN pnpm install --frozen-lockfile \
  && pnpm --filter @neo-bot/domain build \
  && pnpm --filter @neo-bot/application build \
  && pnpm --filter @neo-bot/pasarguard build \
  && pnpm --filter @neo-bot/database build \
  && pnpm --filter @neo-bot/bot-api build
ENV NODE_ENV=production
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||'3100')+'/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/bot-api/dist/main.js"]
