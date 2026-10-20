import { PROTOCOL_VERSION } from '../constants.js';

export function messageId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

export function envelope(type, payload = {}, id = null) {
  return { v: PROTOCOL_VERSION, id, type, payload };
}

export function parseEnvelope(text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    !message ||
    message.v !== PROTOCOL_VERSION ||
    typeof message.type !== 'string' ||
    !message.payload ||
    typeof message.payload !== 'object'
  ) {
    return null;
  }
  return message;
}

