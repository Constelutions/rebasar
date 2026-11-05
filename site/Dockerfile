# ---- Build stage: compile the Astro static site ----
# Base images are pinned by digest; Dependabot (.github/dependabot.yml) rewrites tag and digest together.
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS build
WORKDIR /app
ENV CI=true

# Node 25+ no longer bundles corepack, so install pnpm through npm.
RUN npm install --global pnpm@11

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Not --prod: `pnpm build` runs `astro check && astro build`, which needs the devDependencies.
RUN pnpm install --frozen-lockfile

COPY . .

# The build reads the releases list from the GitHub API; a token only raises the rate limit.
ARG GITHUB_TOKEN
RUN pnpm build

# Precompress text assets so nginx serves brotli -11 and gzip -9 bytes without request-time CPU.
# Skipped for already-compressed formats and anything under 512 B, where framing cancels the gain.
RUN apk add --no-cache brotli \
    && find dist -type f -size +512c \
      \( -name '*.html' -o -name '*.css' -o -name '*.js' -o -name '*.mjs' \
         -o -name '*.svg' -o -name '*.json' -o -name '*.xml' -o -name '*.txt' \) \
      -print0 \
    | xargs -0 -r -I{} sh -c 'gzip -9 -c "{}" > "{}.gz" && brotli -Z -c "{}" > "{}.br"'

# ---- Runtime stage: nginx with the Server header stripped ----
# Plain alpine rather than nginx:*-alpine, so nginx and its nginx-mod-* modules come from the same
# apk snapshot: the modules are ABI-sensitive and fail at startup against a mismatched binary.
FROM alpine:3.24@sha256:be2656061b536c1883c4034790e21d0a09c5aaaf51968b89368a3c0371ea2c9a

# nginx itself is not pinned: rebuild periodically to pick up Alpine's nginx patches.
RUN apk add --no-cache nginx nginx-mod-http-headers-more nginx-mod-http-brotli

COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
