import { app } from 'electron';
import path from 'path';

app.setName('jnbot');

if (
  process.env.NODE_ENV === 'development' ||
  process.env.DEBUG_PROD === 'true'
) {
  const {build} = require('../../package.json')
  const appData = app.getPath('appData')
  app.setPath('userData', path.join(appData, build.productName))

}
