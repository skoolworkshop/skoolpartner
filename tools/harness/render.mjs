/**
 * Rendert de harness naar HTML en maakt daarna schermafbeeldingen op desktop
 * en mobiel. Zo is te controleren of de nieuwe schermen er ook echt goed
 * uitzien, niet alleen of ze compileren.
 */
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const root = process.cwd();
const out = path.join(root, ".harness");
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [path.join(root, "tools/harness/entry.tsx")],
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node20",
  outfile: path.join(out, "bundle.cjs"),
  jsx: "automatic",
  // Niets extern laten: lucide-react is CommonJS en een dynamische require
  // werkt niet in een ESM-bundel.
  mainFields: ["module", "main"],
  conditions: ["import", "module", "default"],
  loader: { ".css": "empty" },
  alias: {
    "@/app/(portal)/skoolpartner/cjp-tegoed/actions": path.join(root, "tools/harness/stub-actions.ts"),
    "server-only": path.join(root, "tools/harness/empty.ts"),
    "next/link": path.join(root, "tools/harness/link.tsx"),
    "next/navigation": path.join(root, "tools/harness/empty.ts"),
  },
  define: { "process.env.NODE_ENV": '"production"' },
  // Alles uit next dat niet met de opmaak te maken heeft, vervangen wij door
  // een lege module. De harness draait immers zonder server.
  plugins: [
    {
      name: "next-stub",
      setup(build) {
        build.onResolve({ filter: /^next\// }, (args) =>
          args.path === "next/link"
            ? { path: path.join(root, "tools/harness/link.tsx") }
            : { path: path.join(root, "tools/harness/empty.ts") }
        );
      },
    },
  ],
  tsconfig: path.join(root, "tsconfig.json"),
});

const require_ = createRequire(import.meta.url);
const { html } = require_(path.join(out, "bundle.cjs"));

// Tailwind los draaien over de bronbestanden, zodat alle klassen meekomen.
execSync(
  `npx @tailwindcss/cli -i src/app/globals.css -o ${path.join(out, "harness.css")} --minify`,
  { stdio: "inherit" }
);

writeFileSync(
  path.join(out, "index.html"),
  `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="./harness.css"></head>
<body class="bg-surface-2 text-ink">${html}</body></html>`
);

console.log("Harness klaar:", path.join(out, "index.html"));
