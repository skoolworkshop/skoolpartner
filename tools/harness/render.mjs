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
// Welke harness: `node tools/harness/render.mjs crm`. Bewust een argument en
// geen omgevingsvariabele, want dat werkt ook in de Windows-opdrachtprompt.
const keuze = process.argv[2] ?? "diagnose";
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
    "@/app/admin/crm/actions": path.join(root, "tools/harness/stub-actions.ts"),
    "server-only": path.join(root, "tools/harness/empty.ts"),
    "next/link": path.join(root, "tools/harness/link.tsx"),
    "next/navigation": path.join(root, "tools/harness/navigation.ts"),
  },
  define: { "process.env.NODE_ENV": '"production"', "process.env.HARNESS": JSON.stringify(keuze) },
  // Alles uit next dat niet met de opmaak te maken heeft, vervangen wij door
  // een lege module. De harness draait immers zonder server.
  plugins: [
    {
      name: "next-stub",
      setup(build) {
        build.onResolve({ filter: /^next\// }, (args) => {
          if (args.path === "next/link") return { path: path.join(root, "tools/harness/link.tsx") };
          if (args.path === "next/navigation") return { path: path.join(root, "tools/harness/navigation.ts") };
          return { path: path.join(root, "tools/harness/empty.ts") };
        });
      },
    },
  ],
  tsconfig: path.join(root, "tsconfig.json"),
});

const require_ = createRequire(import.meta.url);
const { html } = require_(path.join(out, "bundle.cjs"));

// Tailwind los draaien over de bronbestanden, zodat alle klassen meekomen.
// De paden staan tussen aanhalingstekens omdat een map met een spatie erin
// anders als twee argumenten wordt gelezen. Op Windows staat een project vaak
// onder een pad met spaties.
execSync(
  `npx @tailwindcss/cli -i "src/app/globals.css" -o "${path.join(out, "harness.css")}" --minify`,
  { stdio: "inherit", shell: true }
);

writeFileSync(
  path.join(out, "index.html"),
  `<!doctype html><html lang="nl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="./harness.css"></head>
<body class="bg-surface-2 text-ink">${html}</body></html>`
);

console.log("Harness klaar:", path.join(out, "index.html"));
