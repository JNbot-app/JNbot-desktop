import './styles.css';

import App_ from './App2';
import Socket from './extra/peer2peer/Socket';
import PeerSocket from './extra/peer2peer/PeerSocket';
import { AppProvider } from './providers/AppProvider';
import AppApiProvider from './providers/AppApiProvider';
import ThemeProvider from './extra/components/AntTheme';

if (window.web === undefined) {
  if (window.ipcRenderer) {
    window.web = false;
  } else {
    window.web = true;
    if (
      window.location.host.endsWith('.netlify.app') ||
      window.location.href.includes('p2p=true')
    ) {
      // P2P
      window.peering = true;
      window.ipcRenderer = new PeerSocket();
    } else {
      window.ipcRenderer = new Socket();
      window.peering = false;
    }
  }

}


const App = () => {
  return (
    <AppProvider>
      <ThemeProvider>
        <AppApiProvider>
          <App_ />
        </AppApiProvider>
      </ThemeProvider>
    </AppProvider>
  );

}

export default App
