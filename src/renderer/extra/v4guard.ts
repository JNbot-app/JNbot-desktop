




window.v4guardWindow = null;

function v4guard() {
  console.log("V4Guard is running");
  const removeListener = window.ipcRenderer.on("v4guard-verify", (data:{url:string,username:string}) => {
    console.log(window.v4guardWindow);
    if(!window.v4guardWindow || window.v4guardWindow[0].closed) {
      const newWindow = window.open(data.url)!;
      const timeoutId = setTimeout(() => {
        if(!window.v4guardWindow) return
        window.v4guardWindow?.[0]?.close();
        window.v4guardWindow = null;
      },60_000);
      
      window.v4guardWindow = [newWindow, timeoutId, data.username];


      window.onclose = () => {
        console.log("V4Guard closed");
        if(!window.v4guardWindow) return
        clearTimeout(window.v4guardWindow?.[1]);
        window.v4guardWindow = null;

      }
    }
  })

  const removeBotJoinListener = window.ipcRenderer.on("activeBots", (data) => {

    for( const bot of data) {
      if(window.v4guardWindow && window.v4guardWindow[2] === bot.username) {
        if(!window.v4guardWindow?.[0]?.closed) {
          window.v4guardWindow?.[0].close?.();
        }
        clearTimeout(window.v4guardWindow?.[1]);
        window.v4guardWindow = null;
      }
    }


  })


  return () => {
    removeListener()
    removeBotJoinListener()
    
    // Clean up any existing v4guard window and timeout
    if (window.v4guardWindow) {
      if (window.v4guardWindow[1]) {
        clearTimeout(window.v4guardWindow[1]);
      }
      if (window.v4guardWindow[0] && !window.v4guardWindow[0].closed) {
        window.v4guardWindow[0].close();
      }
      window.v4guardWindow = null;
    }
  }
}


export default v4guard;
