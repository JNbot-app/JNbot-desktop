/**********************************************

Bot Made by usserwout

***********************************************/

const join = require('../bot/join');
const { getScriptSettings } = require('../bot/scriptFunctional');


function main(args) {
  const scriptSettings = getScriptSettings('chat') ?? {};
  const op = args?.username ? args : scriptSettings;
  if (!op?.username) return;
  try {
    join(
      {
        username: op.username,
        version: op.version,
      },
      {
        stopOnEnd: true,
        retryOnLoginFail: true,
      },
    );
  } catch (err) {
    console.log(err);
  }
}

module.exports = main;
