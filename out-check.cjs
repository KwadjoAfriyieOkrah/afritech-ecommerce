const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const tw = require('@tailwindcss/postcss');
const lightningcss = require('lightningcss');

const file = path.resolve('src/styles/globals.css');
const css = fs.readFileSync(file, 'utf8');

const tryParse = (label, code, minify) => {
  try {
    lightningcss.transform({ filename: file, code: Buffer.from(code, 'utf8'), minify });
    console.log('OK   ', label);
    return true;
  } catch (error) {
    console.log('FAIL ', label, '->', error.message, JSON.stringify(error.loc));
    return false;
  }
};

postcss([tw()])
  .process(css, { from: file })
  .then((result) => {
    const generated = result.css;
    console.log('starts with BOM:', generated.charCodeAt(0) === 0xfeff);

    tryParse('as-is (minify)', generated, true);
    tryParse('as-is (no minify)', generated, false);
    tryParse('BOM stripped (minify)', generated.replace(/^\ufeff/, ''), true);
    tryParse('BOM stripped (no minify)', generated.replace(/^\ufeff/, ''), false);

    const stripped = generated.replace(/^\ufeff/, '');
    fs.writeFileSync('out.css', stripped);
    console.log('first 3 lines:');
    console.log(JSON.stringify(stripped.split('\n').slice(0, 3)));
  })
  .catch((error) => {
    console.error('POSTCSS FAILED:', error.message);
    process.exit(1);
  });