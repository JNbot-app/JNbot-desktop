const items = require('./textures.json');
const fetch = require('node-fetch');
const fs = require('fs');
const { parse } = require('node-html-parser');
let counter = 0;
(async () => {
  for await (item of Object.keys(items)) {
    if (items[item].startsWith('https://fr-minecraft.net')) continue;
    const response = await fetch(
      `https://fr-minecraft.net/recherche.php?search=${item}`
    );
    const html = await response.text();
    const document = parse(html);
    document.querySelectorAll('.tr').forEach((e) => {
      const img =
        'https://fr-minecraft.net/' +
        e.querySelector('img')?.getAttribute('src');
      if (!img || img.endsWith('/pixel.png')) return;
      const item_name = e
        .querySelector('.english')
        ?.innerText?.trim()
        ?.toLowerCase()
        .replace(/ /g, '_');
      if (!item_name) return;
      if (item_name in items) {
        items[item_name] = img;

        counter++;
        if (counter > 20) {
          fs.writeFileSync(
            __dirname + '/textures.json',
            JSON.stringify(items, null, 2)
          );
          counter = 0;
        }
      }
    });
  }
  fs.writeFileSync(
    __dirname + '/textures.json',
    JSON.stringify(items, null, 2)
  );
})();
