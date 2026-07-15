# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV NEXT_TELEMETRY_DISABLED=1

# Variáveis NEXT_PUBLIC_* são embutidas no bundle do browser em TEMPO DE BUILD
# (não lidas em runtime). Sem elas aqui, o client Supabase do browser nunca é
# criado e o Realtime fica desligado (inbox não atualiza ao vivo).
#
# Os defaults abaixo são chaves PÚBLICAS por design (URL do projeto + publishable
# key), expostas no bundle do browser de qualquer forma — a segurança do banco
# vem da RLS por tenant, não do sigilo destas chaves. A service_role NUNCA entra
# aqui (não é NEXT_PUBLIC, só existe no runtime server). Para trocar de projeto,
# sobrescreva via --build-arg no docker build.
ARG NEXT_PUBLIC_SUPABASE_URL=https://vdgudeijxxbaghqaxpip.supabase.co
ARG NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_hTuo4Zzj7tI-e6QXqITAaQ_bI4nQG83
ARG NEXT_PUBLIC_APP_URL=https://app.vozzyup.com.br
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# Artefatos do standalone
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Migrações exigidas por /api/installer/run-stream (outputFileTracingIncludes)
COPY --from=builder /app/supabase/migrations ./supabase/migrations

USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
