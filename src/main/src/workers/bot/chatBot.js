const axios = require('axios');

class Chatbot {
  messages = [];
  answers = [];
  constructor(name) {
    this.name = encodeURI(name);
  }

  async ask(message, speakingTo = 'user') {
    this.addMessage(message);
    const date = Date.now();

    const body =
      'request=' +
      this.messages
        .map(
          (m, i) =>
            `request${i === 0 ? '' : '_' + i}=${m}${
              i === 0 ? '' : `&answer_${i}=${this.answers[i - 1]}`
            }`
        )
        .join('&') +
      `&bot_name=${
        this.name
      }&user_name=${speakingTo}&dialog_lang=en&dialog_id=8010edaa-944b-4226-ac88-7eb513e60d86&a=public-api&b=1&c=${this.signMessage(
        date
      )}&d=1&e=1&t=${date}&x=1`;
    try {
      const response = await axios.post('http//p-bot.ru/api/getAnswer', body);
      if (response.data.status === 'OK') {
        this.addAnswer(response.data.answer);
        return response.data.answer.replace(
          /(ρBot|p-bot|roBot|pbot)/gi,
          this.name
        );
      } else {
        return { error: 'Failed with status ' + response.status };
      }
    } catch (err) {
      console.log(err);
      return { error: 'Failed to make request' };
    }
  }

  addMessage(message) {
    message = encodeURIComponent(message);
    this.messages ??= [];
    this.messages.unshift(message);
    this.messages = this.messages.slice(0, 4);
  }

  addAnswer(answer) {
    answer = encodeURIComponent(answer);
    this.answers ??= [];
    this.answers.unshift(answer);
    this.answers = this.answers.slice(0, 4);
  }

  signMessage(date) {
    let key =
      'public-api' +
      date +
      'qVxRWnespIsJg7DxFbF6N9FiQR5cjnHy' +
      'ygru3JcToH4dPdiN' +
      'H5SXOYIc00qMXPKJ';

    let str;
    var arr = [];
    for (let i = 0; i < 256; i++) {
      str = i;
      for (let j = 0; j < 8; j++) {
        str = str & 1 ? 3988292384 ^ (str >>> 1) : str >>> 1;
      }
      arr[i] = str;
    }
    let count = -1;
    for (let i = 0; i < key.length; i++) {
      count = (count >>> 8) ^ arr[(count ^ key.charCodeAt(i)) & 255];
    }
    return (count ^ -1) >>> 0;
  }
}

// const aiBot = new ChatMessages('Zola');
// aiBot.addAnswer('I am fine');
// aiBot.ask('how old are you', 'usserwout');
// aiBot.addAnswer('I am 18');
// aiBot.ask('what ya doing??', 'usserwout');
// (async () => {
//   const answer = await aiBot.ask('Who am I?', 'usserwout');
//   console.log(answer);
//   const answer1 = await aiBot.ask('What is my name?', 'usserwout');
//   console.log(answer1);
//   const answer2 = await aiBot.ask('Do you know my name?', 'usserwout');
//   console.log(answer2);
// })();

// const inject = (bot) => {
//   (bot.messages = []),
//     (bot.getResponse = async (message) => {
//       let body = 'stimulus=';

//       body +=
//         '&cb_settings_language=en&cb_settings_scripting=no&sessionid=WYBD94XNHP&islearning=1&icognoid=wsf&icognocheck=1f6ed14bb59448947b7aaed0b4479ee5';
//     });
// };

module.exports = Chatbot;
