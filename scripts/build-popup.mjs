import { build } from "esbuild";

await build({
  entryPoints: ["src/popup/main.jsx"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["chrome114"],
  outfile: "src/popup/popup.bundle.js",
  jsx: "automatic",
  minify: true,
  legalComments: "none",
  logLevel: "info"
});
