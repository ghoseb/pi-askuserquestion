import { defineConfig } from "vitest/config";

const PI_NM = "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent/node_modules";
const PI_ROOT = "/opt/homebrew/lib/node_modules/@mariozechner/pi-coding-agent";

export default defineConfig({
  resolve: {
    alias: {
      "@mariozechner/pi-tui": `${PI_NM}/@mariozechner/pi-tui/dist/index.js`,
      "@mariozechner/pi-coding-agent": `${PI_ROOT}/dist/index.js`,
      "@sinclair/typebox": `${PI_NM}/@sinclair/typebox/build/esm/index.mjs`,
    },
  },
});
