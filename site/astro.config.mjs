import sitemap from "@astrojs/sitemap";
import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://rebasar.constelutions.tech",
  integrations: [sitemap()],
  devToolbar: { enabled: false },
});
