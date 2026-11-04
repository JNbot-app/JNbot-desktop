const esbuild = require('esbuild');
const { createServer } = require('http');

esbuild
  .context({
    entryPoints: ['./src/renderer/index.tsx'], // Adjust this path to your renderer entry file
    bundle: true,
    minify: true,
    platform: 'browser',
    outfile: './dist/renderer.js', // Adjust output path as needed
    loader: {
      '.png': 'file',
      '.webp': 'file',
      '.mp3': 'file',
      '.woff': 'file',
      '.woff2': 'file',
      '.ttf': 'file',
      '.svg': 'file',
      '.tsx': 'tsx',
      '.jsx': 'jsx',
    },
  })
  .then((ctx) => {
    ctx.watch();
  })
  .catch(() => process.exit(1));

// Simple live reload server for esbuild
const clients = [];

createServer((req, res) => {
  const { url } = req;
  if (url === '/__esbuild') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      Connection: 'keep-alive',
    });
    clients.push(res);
    req.on('close', () => {
      clients.splice(clients.indexOf(res), 1);
    });
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(3000);

const send = (message) => {
  clients.forEach((res) => res.write(`data: ${message}\n\n`));
};

setInterval(() => send('ping'), 30000);
