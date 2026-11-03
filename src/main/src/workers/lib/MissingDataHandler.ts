import { workerData } from 'worker_threads';
import { prompt } from '../compiler/scriptApi';



async function handleMissingTransferUsername(script: string): Promise<string> {
  const answer = await prompt({
    title: `To which account does the bot need to transfer items to? (${script})`,
    placeholder: 'username',
    label:
      'No username has been set for item transfers. Please enter the username of the account you want the bots to transfer the items to.',
    defaultValue: '',
    description: '',
  });

  const username = answer.response.trim();
  if (username.length === 0) {
    throw new Error('Username cannot be empty');
  }

  return username;
}

async function handleMissingPassword(
  username: string,
  script = workerData.scriptName,
) {
  const alt = global.settings.altData?.[username]

  const answer = await prompt({
    title: `Password ${username} requested (${script})`,
    placeholder: 'password',
    label: `No password has been found for ${username}. Enter the password for this account or ${alt ? "update the alt's password in your alt list" : 'add this alt account'}.`,
    defaultValue: '',
    description: '',
  });
  const password = answer.response.trim();
  if (password.length === 0) {
    throw new Error('Password cannot be empty');
  }

  if (alt) {
    alt.password = password;
    // saveSettings();
  }
  return password;
}

function getOrAskPassword(username: string) {
  const alt = global.settings.altData[username]
  if (alt?.password) return alt.password;
  return handleMissingPassword(username);
}

function getOrAskTransferToUsername() {
  workerData.settings.scripts ??= {};
  const username =
    workerData.settings.scripts[workerData.scriptName]?.username;
  return username || handleMissingTransferUsername(workerData.scriptName);
}

export { getOrAskTransferToUsername, getOrAskPassword };
