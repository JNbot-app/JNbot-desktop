export type Address = number & { readonly __address: unique symbol };

export const BACKEND = 0 as Address;
export const ADDRESS_VERSION = 1;
export const FIELD_BITS = 13;
export const FIELD_BASE = 2 ** FIELD_BITS;
export const MAX_FIELD_ID = FIELD_BASE - 1;
const EXTENSION_FACTOR = 2 ** 39;
export const KIND_FACTOR = 2 ** 40;
export const RESERVED_FACTOR = 2 ** 43;
export const MAX_ADDRESS = 2 ** 48 - 1;

export enum DestinationKind {
  CLIENT = 1,
  WORKER = 2,
  SERVICE = 3,
}

export interface DecodedAddress {
  kind: 'backend' | 'client' | 'worker' | 'service';
  profileId: number;
  scriptId: number;
  leafId: number;
}

function field(name: string, value: number, allowZero: boolean): number {
  if (
    !Number.isSafeInteger(value) ||
    value < (allowZero ? 0 : 1) ||
    value > MAX_FIELD_ID
  ) {
    throw new RangeError(
      `${name} must be an integer between ${allowZero ? 0 : 1} and ${MAX_FIELD_ID}`,
    );
  }
  return value;
}

function encode(
  kind: DestinationKind,
  profileId: number,
  scriptId: number,
  leafId: number,
): Address {
  const value =
    kind * KIND_FACTOR +
    profileId * FIELD_BASE ** 2 +
    scriptId * FIELD_BASE +
    leafId;
  return assertAddress(value);
}

export function clientAddress(clientId: number): Address {
  return encode(
    DestinationKind.CLIENT,
    0,
    0,
    field('clientId', clientId, false),
  );
}

export function workerProfileAddress(profileId: number): Address {
  return encode(
    DestinationKind.WORKER,
    field('profileId', profileId, false),
    0,
    0,
  );
}

export function workerScriptAddress(
  profileId: number,
  scriptId: number,
): Address {
  return encode(
    DestinationKind.WORKER,
    field('profileId', profileId, false),
    field('scriptId', scriptId, false),
    0,
  );
}

export function workerBotAddress(
  profileId: number,
  scriptId: number,
  botId: number,
): Address {
  return encode(
    DestinationKind.WORKER,
    field('profileId', profileId, false),
    field('scriptId', scriptId, false),
    field('botId', botId, false),
  );
}

export function serviceAddress(serviceId: number): Address {
  return encode(
    DestinationKind.SERVICE,
    0,
    0,
    field('serviceId', serviceId, false),
  );
}

export function decodeAddress(address: Address | number): DecodedAddress {
  assertAddress(address);
  if (address === BACKEND) {
    return {
      kind: 'backend',
      profileId: 0,
      scriptId: 0,
      leafId: 0,
    };
  }

  const kindValue = Math.floor(address / KIND_FACTOR) % 8;
  const profileId = Math.floor(address / FIELD_BASE ** 2) % FIELD_BASE;
  const scriptId = Math.floor(address / FIELD_BASE) % FIELD_BASE;
  const leafId = address % FIELD_BASE;

  if (kindValue === DestinationKind.CLIENT) {
    if (profileId !== 0 || scriptId !== 0 || leafId === 0)
      throw new TypeError('Malformed client address');
    return { kind: 'client', profileId, scriptId, leafId };
  }
  if (kindValue === DestinationKind.WORKER) {
    if (profileId === 0 || (leafId !== 0 && scriptId === 0)) {
      throw new TypeError('Malformed worker address');
    }
    return {
      kind: 'worker',
      profileId,
      scriptId,
      leafId,
    };
  }
  if (kindValue === DestinationKind.SERVICE) {
    if (profileId !== 0 || scriptId !== 0 || leafId === 0) {
      throw new TypeError('Malformed service address');
    }
    return {
      kind: 'service',
      profileId,
      scriptId,
      leafId,
    };
  }
  throw new TypeError(`Unknown destination kind: ${kindValue}`);
}

export function assertAddress(value: number): Address {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_ADDRESS) {
    throw new RangeError(`Invalid address: ${String(value)}`);
  }
  if (value !== 0 && value < KIND_FACTOR)
    throw new TypeError('Only zero is a reserved low address');
  if (value >= RESERVED_FACTOR)
    throw new TypeError('Reserved address bits must be zero');
  if (Math.floor(value / EXTENSION_FACTOR) % 2 === 1)
    throw new TypeError('Address extension bit is reserved');
  if (value !== 0) {
    const kindValue = Math.floor(value / KIND_FACTOR) % 8;
    if (
      kindValue < DestinationKind.CLIENT ||
      kindValue > DestinationKind.SERVICE
    ) {
      throw new TypeError(`Unknown destination kind: ${kindValue}`);
    }
    const profileId = Math.floor(value / FIELD_BASE ** 2) % FIELD_BASE;
    const scriptId = Math.floor(value / FIELD_BASE) % FIELD_BASE;
    const leafId = value % FIELD_BASE;
    if (
      kindValue === DestinationKind.CLIENT &&
      (profileId !== 0 || scriptId !== 0 || leafId === 0)
    ) {
      throw new TypeError('Malformed client address');
    }
    if (
      kindValue === DestinationKind.WORKER &&
      (profileId === 0 || (leafId !== 0 && scriptId === 0))
    ) {
      throw new TypeError('Malformed worker address');
    }
    if (
      kindValue === DestinationKind.SERVICE &&
      (profileId !== 0 || scriptId !== 0 || leafId === 0)
    ) {
      throw new TypeError('Malformed service address');
    }
  }
  return value as Address;
}

export function formatAddress(address: Address): string {
  const decoded = decodeAddress(address);
  if (decoded.kind === 'backend') return 'backend:0';
  if (decoded.kind === 'client') {
    return `client:${decoded.leafId}`;
  }
  if (decoded.kind === 'worker') {
    const suffix =
      decoded.scriptId === 0
        ? `${decoded.profileId}`
        : decoded.leafId === 0
          ? `${decoded.profileId}/${decoded.scriptId}`
          : `${decoded.profileId}/${decoded.scriptId}/${decoded.leafId}`;
    return `worker:${suffix}`;
  }
  return `service:${decoded.leafId}`;
}

export class RunIdAllocator {
  private nextId = 1;

  constructor(private readonly label: string) {}

  allocate(): number {
    if (this.nextId > MAX_FIELD_ID)
      throw new RangeError(`${this.label} ID space exhausted`);
    return this.nextId++;
  }
}
