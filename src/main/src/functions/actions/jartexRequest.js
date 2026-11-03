const { BrowserWindow, session } = require("electron")
const axios = require("axios")

let browserWindow = null
let isLoading = false // Prevents multiple windows from being opened at once

async function CLIjnFetch(url, returnJson) {
  const response = await axios.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3"
    }
  })
  if (returnJson) return response.data
  return typeof response.data === "string" ? response.data : JSON.stringify(response.data)
}

// Window closes after not being used for 3 minutes
async function jnFetch(options={}) {
  if(!options.url) throw new Error("No URL provided")
  const { json = false, url = ""} = options
  if(process.env.CLI_MODE === "true") {
    return CLIjnFetch(url, json)
  }

  if (!browserWindow && !isLoading) {
    let childWin = await openWindow(url)
    if (!childWin) return null
    browserWindow = {
      window: childWin,
      alive: setTimeout(cleanup, 1000 * 60 * 3)
    }
  }
  await waitForLoad()
  clearTimeout(browserWindow.alive)
  browserWindow.alive = setTimeout(cleanup, 1000 * 60 * 3)
  try {
    const result = await browserWindow.window.webContents.executeJavaScript('fetch("' + url + '").then(resp => resp.text())', true)
    if(json) return JSON.parse(result)
    return result
  } catch (err) {
    console.error(err);
    return null
  }


  function cleanup() {
    if (!browserWindow) return
    clearTimeout(browserWindow.alive)
    browserWindow.window.destroy()
    browserWindow = null
  }

}

function waitForLoad() {
  if (!isLoading) return
  return new Promise(async (resolve) => {
    while (isLoading) await sleep(100)
    resolve()
  })
}

async function openWindow(url) {
  isLoading = true
  return new Promise(async (resolve) => {
    const child = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true }
    })
    const timeout = setTimeout(()=>{
      child.destroy()
      resolve(null)
    }, 60_000) // timeout after 1 minute
    child.webContents.setFrameRate(1)
    await session.defaultSession.cookies.remove(url, "cf_clearance")
    child.loadURL(url)
    child.on('ready-to-show', onPageLoadHandler)
    async function onPageLoadHandler() {
      const cookies = await session.defaultSession.cookies.get({ url, name: "cf_clearance" })
      if ( !(await checkIfLoaded())  ) return
      isLoading = false
      clearTimeout(timeout)
      resolve(child)
    }
    async function checkIfLoaded() {
      const cookies = await session.defaultSession.cookies.get({ url, name: "cf_clearance" })
      if (cookies.length && cookies[ 0 ]) return true
      const elCount = parseInt(await child.webContents.executeJavaScript('document.all.length', true))
      if (elCount > 1) return true
      return false
  }
  })

}



function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}


module.exports = jnFetch
