



export interface Socket {
  on: (event: string, cb: (args:any) => void) => void
  once: (event: string, cb: (args:any) => void) => void
  emit: (event: string, args:any) => void
  off: (event: string, cb: (args:any) => void) => void
  removeAllListeners: (event: string) => void
  removeListener: (event: string, cb: (args:any) => void) => void
  broadcast: (event: string, args:any) => void
  disconnect: () => void
}




