export class MessagingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class MessageTimeoutError extends MessagingError {
  constructor(event: string) {
    super(`Message request timed out: ${event}`, 'MESSAGE_TIMEOUT');
  }
}

export class RouteUnavailableError extends MessagingError {
  constructor(message = 'Message route is unavailable') {
    super(message, 'ROUTE_UNAVAILABLE');
  }
}

export class MessengerClosedError extends MessagingError {
  constructor() {
    super('Messenger is closed', 'MESSENGER_CLOSED');
  }
}
