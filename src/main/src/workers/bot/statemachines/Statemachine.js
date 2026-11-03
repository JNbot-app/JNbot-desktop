class Statemachine {
  active = false;
  paused = false;
  bot;
  targets = {
    events: {},
  };


  /**
   * @type {Array<Behaviour>}
   * @interface Behaviour {
   *  shouldTrigger: () => boolean,
   *  action: () => void | ()=>Promise<void> | ()=>StateMachine | Array<()=>Promise<any>>,
   *  name: string,
   *  }
   */
  behaviours = [];

  onFinishCallbacks = [];

  options = {
    delay: global.appSettings.delay_between_actions??250,
    stopOnIdle: true,
    resetOnceOnEnd: false, // useful for resetting listeners after bot rejoins
    targets: {},
    debug: true,
    extensions: {
      reconnect: false, // will be default true if target.alt is set
      rejoinGm: false, // will be default true if target.joinOptions.gamemode is set
    },
  };

  constructor(behaviours = [], options = {}) {
    this.options = Object.assign(this.options, options);
    this.targets = Object.assign(this.targets, options.targets || {});
    this.behaviours = this.behaviours.concat(behaviours);
    this.targets.__this = this;
    this.bot = null;
  }

  addBehaviour(behaviour) {
    this.behaviours.push(behaviour);
  }

  onFinish(cb) {
    if (cb instanceof Function) this.onFinishCallbacks.push(cb);
  }

  resetOnce(){
    this.behaviours.forEach(b=>b.ignore = false)
  }

  activate(){
    this.active = true;
    return this
  }

  resume(){
    this.paused = false;
    return this
  }

  start() {
    if (this.active) return this;
    this.active = true;
    this.clock();
    return this;
  }

  pause() {
    this.paused = true;
    return this;
  }


  callStopCallbacks(bot = this.bot, targets = this.targets){
    for (let cb of this.onFinishCallbacks) {
      cb(bot, targets);
    }
  }

  stop(bot = this.bot, targets = this.targets) {
    if (!this.active) return;
    this.callStopCallbacks( bot, targets);
    for (let behaviour of this.behaviours) {
      if (behaviour.action instanceof Statemachine)
        behaviour.action.stop(bot, targets);
    }
    this.active = false;
  }

  interrupt(reason) {
    try {
      if (reason) {
        const username = this.targets?.alt?.username || this.bot?.username || '';
        global.log(`[State ${username}] Interrupted: ${reason}`, 'warning');
      }
    } catch (_) {}
    this.stop();
  }

  async clock() {
    while(this.active) {
      if(!this.paused) await this.trigger();
      await sleep(this.options.delay);
    }
  }

  async trigger(
    bot = this.bot,
    targets = this.targets,
    behaviours = this.behaviours
  ) {
    let action = null;
    let username = targets?.alt?.username || this.bot?.username || '';
    for (let i = 0; i < behaviours.length; i++) {
      if (
        !this.behaviours[i].ignore &&
        this.behaviours[i].shouldTrigger(bot, targets)
      ) {
        if (
          this.options.debug &&
          this.behaviours[i].name &&
          typeof this.behaviours[i].action === "function"
        ) {
          global.log(`[State ${username}] ${this.behaviours[i].name}`);
        }
        if (this.behaviours[i].action instanceof Statemachine) {
          if (!this.behaviours[i].action.active) continue
          action = this.behaviours[i].action.trigger(bot, targets);
        } else if (typeof this.behaviours[i].action === 'function') {
          action = this.behaviours[i].action(bot, targets);
        } else if (Array.isArray(this.behaviours[i].action)) {
          action = this.trigger(bot, targets, this.behaviours[i].action);
        } else {
          console.log('Behaviour action is not a function or state machine');
          throw new Error(
            'Behaviour action is not a function or state machine. Type: ' +
              typeof this.behaviours[i].action
          );
        }
        if (this.behaviours[i].once) this.behaviours[i].ignore = true;
        break;
      }
    }

    if (action !== null) {
      await action;
      return;
    } else if (this.options.stopOnIdle) this.stop(bot, targets);
  }
}

function sleep(x) {
  return new Promise((resolve) => setTimeout(resolve, x));
}

module.exports = Statemachine;
