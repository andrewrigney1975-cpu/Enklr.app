import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/* Builds the standalone Whiteboard tool (enklr.app/tools/whiteboard) into a single self-contained
   dist/tools/whiteboard/index.html — same "inline everything, one portable file" shape build.js
   uses for the main app, just a separate, much smaller entry point (src/tools/whiteboard/app.js)
   that reuses a handful of the main app's own pure drawing-logic modules (features/whiteboard-
   draw.js, views/dependency-map.js's roundedOrthogonalPathD) but never imports storage.js/api.js
   in any way that touches localStorage app state or the network — see src/tools/whiteboard/app.js's
   own header comment. Deliberately a THIRD build script alongside build.js/build-help-site.js
   rather than folding into either: build.js's own bundling is specifically the main app's src/js/
   app.js import graph, and this tool is a genuinely separate page with its own <html>, not part of
   the SPA shell or the static /help/ doc site.

   Run manually (`node build-whiteboard-tool.js`) whenever src/tools/whiteboard/ changes, same "build
   once, commit the artifact" precedent as dist/index.html and dist/help/ — web/Dockerfile copies
   dist/tools/ straight from the build context, no compilation needed inside the Docker build. */

const __dirname = dirname(fileURLToPath(import.meta.url));

async function build() {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, 'src/tools/whiteboard/app.js')],
    bundle: true,
    format: 'iife',
    minify: true,
    write: false,
    sourcemap: false,
  });

  const bundledJs = result.outputFiles[0].text;

  const css = readFileSync(join(__dirname, 'src/css/styles.css'), 'utf8');
  const html = readFileSync(join(__dirname, 'src/tools/whiteboard/index.html'), 'utf8');

  const cssResult = await esbuild.transform(css, { loader: 'css', minify: true });
  const minifiedCss = cssResult.code.trim();

  // Function replacers (not plain strings) — see build.js's own comment on why: String.replace
  // treats $-sequences in a plain replacement string specially, and would silently corrupt the
  // bundle if it ever legitimately contained one.
  let output = html.replace(
    '<link rel="stylesheet" href="css/styles.css">',
    () => `<style>\n${minifiedCss}\n  </style>`
  );
  output = output.replace(
    '<script type="module" src="app.js"></script>',
    () => `<script>\n${bundledJs}\n  </script>`
  );

  mkdirSync(join(__dirname, 'dist/tools/whiteboard'), { recursive: true });
  writeFileSync(join(__dirname, 'dist/tools/whiteboard/index.html'), output, 'utf8');
  console.log('Built dist/tools/whiteboard/index.html');
}

build().catch(err => { console.error(err); process.exit(1); });
