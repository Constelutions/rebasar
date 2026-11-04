# Rebasar marketing site

The public website for Rebasar, at https://rebasar.constelutions.tech. A static [Astro](https://astro.build) site, deployed on Constelutions' Coolify server from its own Dockerfile.

It is a **standalone project**: it has its own `package.json` and lockfile and is not part of the root pnpm workspace, so the root `pnpm -r` scripts and CI jobs ignore it and the Docker build context is just this folder.

The design source is the Claude Design mockup in [`../prototypes/mockups/marketing-site/`](../prototypes/mockups/marketing-site/). `Rebasar Notes.md` there lists the placeholders and judgement calls. The names, hashes and PR numbers in the faux-UI panels are illustrative (`src/data/sample.ts`); the copy and the numbers in the performance strip are not, and must stay true to the product ([`CONTEXT.md`](../CONTEXT.md), [ADR-0003](../docs/adr/0003-no-undo.md), [`docs/benchmark-report.md`](../docs/benchmark-report.md)).

## Develop

Needs Node 24 and pnpm.

```sh
pnpm install
pnpm dev          # http://localhost:4321
pnpm test         # Vitest: the release resolver, download cards, OS detection, commit graph layout
pnpm typecheck    # astro check
pnpm build        # astro check && astro build, output in dist/
pnpm preview      # serve dist/
```

## How it is built

- **Tokens.** `src/styles/tokens.css` reuses the names and values of `ui/src/tokens.css`. The site is dark only. Keep the two in step when the app's palette changes.
- **Fonts.** Geist and JetBrains Mono come from `@fontsource-variable`, so the page makes no third-party requests.
- **Faux-UI panels.** Plain HTML and CSS, `aria-hidden`, no JavaScript. Responsive behaviour is media queries; the hero panel is drawn at 1280px and cropped, never scaled.
- **Client JavaScript.** Two small scripts: the mobile menu in `Nav.astro` and `src/scripts/os-highlight.ts`, which highlights the visitor's platform and adapts the hero button. Without JavaScript the Windows card is highlighted.

### Downloads

The Downloads section is rendered **at build time** from the GitHub Releases API (`src/lib/releases.ts`). It lists the releases and takes the newest non-draft one, because `releases/latest` skips pre-releases and every release is one today ([ADR-0004](../docs/adr/0004-beta-and-stable-release-channels.md)). The asset names are a contract documented in [`docs/releasing.md`](../docs/releasing.md).

If the API call fails, or an asset is missing, the affected buttons fall back to the repository's releases page. The build never fails because of it.

Because the page is static, a new release only shows once the site is rebuilt. `release.yml` does this: its "Tell the website a release was published" step posts to the `SITE_DEPLOY_WEBHOOK` secret.

An optional `GITHUB_TOKEN` (environment variable locally, build argument in Docker or Coolify) raises the API rate limit.

## Run the container

```sh
docker compose up --build      # http://localhost:8082
curl -i http://localhost:8082/healthz
```

The image follows the Constelutions blog's: a Node 24 build stage that precompresses text assets with gzip and brotli, then Alpine with nginx, brotli and `headers-more`. nginx sends no `Server` header, adds the security headers, caches `/_astro/` forever and answers `/healthz` for the health check. Port 8082 avoids the blog's 8081.

Both base images are pinned by digest, and `.github/dependabot.yml` opens a weekly PR that rewrites the tag and digest together. nginx answers scanner probes (dotfiles other than `.well-known`, `.php` and similar extensions, and paths such as `wp-admin` or `phpmyadmin`) with a fast 404. It does not use 444: behind Coolify's proxy a dropped connection surfaces as a 502, so banning scanners belongs at the proxy or firewall. The `nginx` package itself is not pinned, so rebuild periodically to pick up Alpine's patches. This follows [Constelutions/blogs#3](https://github.com/Constelutions/blogs/pull/3).

## Deploy (manual steps in Coolify)

These are one-off steps, not part of any pull request:

1. **DNS.** Point `rebasar.constelutions.tech` at the Coolify server.
2. **Resource.** In Coolify create an application from this repository with the **Dockerfile** build pack. Set Base Directory to `site`, branch `develop`, domain `rebasar.constelutions.tech`, port 80, and `/healthz` as the health check path. Turn on auto-deploy through the GitHub App so a push to `develop` rebuilds it.
3. **Release webhook.** Copy the resource's deploy webhook into the repository secret `SITE_DEPLOY_WEBHOOK`, so each published release rebuilds the site.
4. **Optional.** Add a `GITHUB_TOKEN` build argument if the Releases API rate limit is ever hit from the build server.

## Not included

GitHub Pages hosting, analytics, cookies or a consent banner, a blog, a 404 page and an Open Graph preview image. Page metadata is text only; the preview image is a follow-up once the site is live.
