const fs = require('fs');
const { SourceMapConsumer } = require('source-map');

async function findErrorInSourceMap() {
  const minifiedCode = fs.readFileSync(
    'release/app/dist/main/main.worker.js',
    'utf-8'
  );
  const sourceMap = fs.readFileSync(
    'release/app/dist/main/main.worker.js.map',
    'utf-8'
  );
  const line = 2; // Adjust the line and column numbers accordingly
  const column = 1435585;

  const consumer = await new SourceMapConsumer(sourceMap);
  const originalPosition = consumer.originalPositionFor({ line, column });
  consumer.destroy();

  console.log('Original position:', originalPosition);
}

findErrorInSourceMap();
