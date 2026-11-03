export enum ServerEvents {
  CREATE_ROOM = 'CREATE_ROOM',
  CONNECT_WITH_SERVER = 'JOIN_ROOM',
  OFFER = 'OFFER',
  ANSWER = 'ANSWER',
  ICE_CANDIDATE = 'ICE_CANDIDATE',
  ROOM_HEARTBEAT = 'ROOM_HEARTBEAT',
  MC_ROOM_STATUS = 'MC_ROOM_STATUS',
}

export enum ClientEvents {
  ERROR = 'ERROR',

  OFFER = 'OFFER',
  ANSWER = 'ANSWER',
  ICE_CANDIDATE = 'ICE_CANDIDATE',

  CONNECT_REQUEST = 'CONNECT_REQUEST',
  ROOM_HEARTBEAT_ACK = 'ROOM_HEARTBEAT_ACK',
  ROOM_CLOSED = 'ROOM_CLOSED',
}

export enum ClientType {
  NODE,
  DEVICE,
  MINECRAFT_HOST,
  MINECRAFT_CLIENT,
}

export type IceCandidatePayload = {
  peerId: string;
  candidate: RTCIceCandidateInit | null;
};

export type ServerEventData = {
  [ServerEvents.CREATE_ROOM]: {
    room: string;
  };
  [ServerEvents.CONNECT_WITH_SERVER]: ClientEventData[ClientEvents.CONNECT_REQUEST];
  [ServerEvents.OFFER]: {
    accepted: boolean;
    offer: string;
    peerId: string;
  };
  [ServerEvents.ANSWER]: {
    answer: string;
    peerId: string;
    deviceId: string;
    password: string;
  };
  [ServerEvents.ICE_CANDIDATE]: IceCandidatePayload;
  [ServerEvents.ROOM_HEARTBEAT]: {
    roomId: string;
  };
};

export type ClientEventData = {
  [ClientEvents.ERROR]: {
    error: string;
    code?: string;
    retry?: boolean;
  };
  [ClientEvents.OFFER]: ServerEventData[ServerEvents.OFFER];
  [ClientEvents.ANSWER]: ServerEventData[ServerEvents.ANSWER];
  [ClientEvents.ICE_CANDIDATE]: IceCandidatePayload;
  [ClientEvents.CONNECT_REQUEST]: {
    roomId: string;
    device: string;
    password: string;
    peerId: string;
    version: string; // app version
    client?: {
      kind: 'web' | 'mobile';
      appVersion: string;
      remoteProtocolVersion: number;
    };
  };
  [ClientEvents.ROOM_HEARTBEAT_ACK]: {
    roomId: string;
    serverTime: number;
  };
  [ClientEvents.ROOM_CLOSED]: {
    roomId: string;
    reason: string;
  };
};
