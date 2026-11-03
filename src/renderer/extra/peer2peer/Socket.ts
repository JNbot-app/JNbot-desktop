import { NotificationInstance } from 'antd/es/notification/interface';
import io from 'socket.io-client';

enum Status {
  CONNECTED,
  CONNECTING,
  DISCONNECTED,
}

class Socket {
  socket: any;
  connecting: boolean = false;
  connected: boolean = false;
  status: Status = Status.DISCONNECTED;
  snackbar!: NotificationInstance;
  setUIState!: Function;
  id!: string;
  token!: string;
  private reconnectInterval: NodeJS.Timeout | undefined;

  async connect() {
    if (this.status !== Status.DISCONNECTED) return;
    this.status = Status.CONNECTING;

    this.socket = io(window.location.host, {
      withCredentials: false,
      // auth: {
      //   token: this.token,
      //   id: this.id,
      // },
    });
    this.socket.on('connect', () => {
      this.status = Status.CONNECTED;
      console.log('Connected!');
      this.login();
    });
    this.socket.on('disconnect', () => {
      this.status = Status.DISCONNECTED;
      console.log('disconnected');
      this.setUIState('Disconnected');

      if (this.reconnectInterval) {
        clearInterval(this.reconnectInterval);
      }

      this.reconnectInterval = setInterval(() => {
        if (this.status === Status.CONNECTED) {
          clearInterval(this.reconnectInterval);
          this.reconnectInterval = undefined;
          return;
        }
        this.socket.connect();
      }, 500);
    });

    this.socket.on(
      'login-status',
      (data: { success?: boolean; message: string }) => {
        if (data.success) {
          console.log('Logged in');
          this.snackbar.success({ message: 'Successfully logged in' });
          this.setUIState('connected');
        } else {
          console.log('Login failed');
          this.snackbar.error({ message: data.message });
          // only remove token if it's incorrect (and not if you're already logged in)
          if (data.message.includes('Incorrect')) {
            localStorage.removeItem('token');
            localStorage.removeItem('id');
          }
          setTimeout(() => {
            this.login(true);
          }, 500);
        }
      },
    );
  }

  emit(event: string, data?: any) {
    this.socket?.emit(event, data);
  }

  on(event: string, callback: Function): Function {
    this.socket?.on(event, callback);
    return () => this.socket?.removeListener(event, callback);
  }

  once(event: string, callback: Function): Function {
    this.socket.once(event, callback);
    return () => this.socket?.removeListener(event, callback);
  }

  send(event: string, data: any) {
    this.socket?.emit('send', event, data);
  }

  action(action: string, data?: any) {
    this.socket?.emit('action', action, data);
  }

  async get(event: string, data?: any) {
    return new Promise((resolve) =>
      this.socket?.emit('get', event, data, resolve),
    );
  }

  async invoke(event: string, data?: any) {
    return new Promise((resolve) =>
      this.socket?.emit('invoke', event, data, resolve),
    );
  }
  removeAllListeners(event: string) {
    this.socket?.removeAllListeners(event);
  }

  removeListener(event: string, callback: Function) {
    this.socket?.removeListener(event, callback);
  }

  async login(retry?: boolean) {
    console.log('Logging in...');
    let token;
    let id;
    if (!retry && (!token || !id)) {
      // url?token=abcd234&id=111333
      let regex = /[?&]([^=#]+)=([^&#]*)/g,
        url = window.location.href,
        params: any = {},
        match;
      while ((match = regex.exec(url))) {
        params[match[1]] = match[2];
      }
      token = params.token;
      id = params.id;
    }
    if (!token || !id) {
      token = localStorage.getItem('token');
      id = localStorage.getItem('id');
    }
    if (!token || !id) {
      do {
        token = prompt('Enter your token');
      } while (!token);
      do {
        id = prompt('Enter your id');
      } while (!id);
    }
    localStorage.setItem('token', token);
    localStorage.setItem('id', id);
    this.id = id;
    this.token = token;
    this.socket.emit('login', { token, id });
  }

  setSnackbar(snackbar: NotificationInstance) {
    this.snackbar = snackbar;
  }

  setLoadingScreen(setLoadingScreen: Function) {
    this.setUIState = setLoadingScreen;
  }

  disconnect() {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
      this.reconnectInterval = undefined;
    }
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.status = Status.DISCONNECTED;
  }
}

export default Socket;
