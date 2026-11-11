import {machineIdSync} from 'node-machine-id';
import fs from 'fs';
import {randomBytes} from 'crypto';
import getAppDataPath from 'appdata-path';
import {join} from 'path';
let uid:string ;


function generateFallbackUID(){

  // The embedded mobile runtime provides its own writable sandbox. Reuse it
  // instead of appdata-path's desktop-oriented ~/.config location.
  const appdata = process.env.JNBOT_USER_DATA || getAppDataPath();
  let filePath = join(appdata, 'jnbot');
  // Check if folder exists
    if (!fs.existsSync(filePath)) {
      fs.mkdirSync(filePath, { recursive: true });
    }

    filePath = join(filePath, 'uid.txt');
   if (!fs.existsSync(filePath)) {
     // Random 64 char string (hex); self generated uid starts with C
     uid = 'C' + randomBytes(32).toString('hex').slice(0, 63);
     fs.writeFileSync(filePath, uid);
   } else {
     uid = fs.readFileSync(filePath).toString();
   }

    if(!uid) throw new Error("Could not generate uid, check your permissions or open the app in administrator");

    
    return uid;
  }
  
function generateUID():string{
  if(uid) return uid;
  try {
    const isCli = process.env.CLI_MODE === 'true' || (global as any)?.isCLI;

    if (isCli) {
      return generateFallbackUID();
    }

    uid = machineIdSync();
    console.log('Generated UID:', uid);
    return uid;
  } catch (e) {
    // It can fail if the administrator disabled registry editing
    return generateFallbackUID();
  }
}

export default generateUID;
