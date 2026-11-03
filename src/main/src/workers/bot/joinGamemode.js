const { once } = require('events')
 const BotStatemachine = require('./statemachines/BotStatemachine');

async function joinGamemode(bot, gamemode, options = {}) {
  throw new Error('joinGamemode is deprecated and should not be used directly!');
  // // if (global.appSettings.server === "pikanetwork") return joinGamemodePika(bot, gamemode, options);
  // return new Promise((resolve)=>{
  //   let targets = {
  //       joinOptions: {
  //         gamemode,
  //       },
  //       extensions: {
  //         joinGm: true,
  //       },
  //     }
  //   const botState = new BotStatemachine(bot, [], {
  //     targets,
  //     stopOnIdle: true,
  //   });
  //   botState.onFinish(() => {
  //     resolve(!targets.__join_data?.timedout)
  //   });
  //   botState.start()
  // })
}

function sleep(x) {
  return new Promise(resolve => setTimeout(resolve, x))
}

module.exports = joinGamemode;
