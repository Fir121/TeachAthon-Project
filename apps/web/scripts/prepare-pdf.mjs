import { cpSync, mkdirSync } from "node:fs";
for (const name of ["cmaps", "standard_fonts", "wasm"]) {
  const destination = new URL(`../public/pdfjs/${name}/`, import.meta.url);
  mkdirSync(destination, { recursive: true });
  cpSync(
    new URL(`../node_modules/pdfjs-dist/${name}/`, import.meta.url),
    destination,
    { recursive: true },
  );
}
