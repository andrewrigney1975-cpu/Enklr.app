const fs = require('fs');
const { execSync } = require('child_process');

function log(label, ok, extra){ console.log((ok?'PASS':'FAIL') + ' - ' + label + (extra!==undefined?' :: '+extra:'')); }

const html = fs.readFileSync('../dist/index.html', 'utf8');

function pngDimensions(buf){
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

(async () => {
  const touchIconMatches = [...html.matchAll(/apple-touch-icon"[^>]*href="data:image\/png;base64,([^"]+)"/g)];
  log('exactly 3 apple-touch-icon links are present', touchIconMatches.length === 3, touchIconMatches.length);

  const expectedSizes = [192, 192, 512];
  touchIconMatches.forEach((m, i) => {
    const buf = Buffer.from(m[1], 'base64');
    const { width, height } = pngDimensions(buf);
    log(`apple-touch-icon #${i} is still ${expectedSizes[i]}x${expectedSizes[i]} (size unchanged by the redesign)`,
        width === expectedSizes[i] && height === expectedSizes[i], `${width}x${height}`);
  });

  const manifestMatch = html.match(/rel="manifest" href="data:application\/manifest\+json;base64,([^"]+)"/);
  log('manifest link is present', !!manifestMatch);
  const manifest = JSON.parse(Buffer.from(manifestMatch[1], 'base64').toString('utf8'));
  log('manifest has exactly 2 icons (192x192 and 512x512)', manifest.icons.length === 2, manifest.icons.length);

  manifest.icons.forEach(icon => {
    const expected = parseInt(icon.sizes.split('x')[0], 10);
    const buf = Buffer.from(icon.src.split(',', 2)[1], 'base64');
    const { width, height } = pngDimensions(buf);
    log(`manifest icon declared as ${icon.sizes} actually decodes to that size`, width === expected && height === expected, `${width}x${height}`);
  });

  function decodePngCornerPixel(buf){
    fs.writeFileSync('/tmp/_icon_check.png', buf);
    const out = execSync('python3 -c "from PIL import Image; im = Image.open(\'/tmp/_icon_check.png\').convert(\'RGBA\'); print(im.getpixel((0,0)))"').toString().trim();
    return out;
  }

  const touchIcon512 = Buffer.from(touchIconMatches[2][1], 'base64');
  const cornerPixel = decodePngCornerPixel(touchIcon512);
  log('the top-left corner pixel of the 512x512 icon is now opaque (alpha=255), confirming the background is full-bleed with no rounding',
      /,\s*255\)$/.test(cornerPixel), cornerPixel);
  log('the corner pixel is the expected blue (#0c66e4 = 12, 102, 228)', cornerPixel.startsWith('(12, 102, 228'), cornerPixel);

  console.log('\nApp icon square/full-bleed redesign test complete.');
  process.exit(0);
})().catch(e => { console.error('CRASHED', e); process.exit(1); });
