import path from "path"
import webpackPaths from './webpack.paths';


const disablePages = false && process.env.NODE_ENV === 'development';


const windows  = disablePages?[] :[
  // {
  //   name: "config",
  //   entry: path.join(webpackPaths.srcRendererPath, "extra", "config", 'ConfigEntry.tsx'),
  // },
  /* {
     "name": "inventory",
     "entry": path.join(webpackPaths.srcRendererPath, "extra", "inventory", 'InventoryEntry.tsx')
   } ,
  {
     "name": "logs",
     "entry": path.join(webpackPaths.srcRendererPath, "extra", "console", 'LogEntry.tsx')
   }*/
]

export default windows
