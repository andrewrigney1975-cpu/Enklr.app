import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

/* Builds the standalone Notes tool (enklr.app/tools/notes) into a single self-contained
   dist/tools/notes/index.html — same shape as build-whiteboard-tool.js (see that file's own header
   comment for the full rationale): a genuinely separate entry point (src/tools/notes/app.js) that
   reuses the main app's own pure rich-text editor modules (rich-text/editor.js, rich-text/
   markdown.js) but never imports storage.js/api.js in any way that touches the network. A FOURTH
   build script alongside build.js/build-help-site.js/build-whiteboard-tool.js, for the same reason
   the whiteboard tool got its own: this is a genuinely separate page with its own <html>, not part
   of the SPA shell, the static /help/ doc site, or the Whiteboard tool's own bundle.

   Run manually (`node build-notes-tool.js`) whenever src/tools/notes/ changes, same "build once,
   commit the artifact" precedent as dist/index.html, dist/help/, and dist/tools/whiteboard/ —
   web/Dockerfile copies the whole dist/tools/ directory, no per-tool Dockerfile change needed. */

const __dirname = dirname(fileURLToPath(import.meta.url));

async function build() {
  const result = await esbuild.build({
    entryPoints: [join(__dirname, 'src/tools/notes/app.js')],
    bundle: true,
    format: 'iife',
    minify: true,
    write: false,
    sourcemap: false,
  });

  const bundledJs = result.outputFiles[0].text;

  const css = readFileSync(join(__dirname, 'src/css/styles.css'), 'utf8');
  const html = readFileSync(join(__dirname, 'src/tools/notes/index.html'), 'utf8');

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

  mkdirSync(join(__dirname, 'dist/tools/notes'), { recursive: true });
  writeFileSync(join(__dirname, 'dist/tools/notes/index.html'), output, 'utf8');
  console.log('Built dist/tools/notes/index.html');
}

build().catch(err => { console.error(err); process.exit(1); });
