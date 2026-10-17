export interface PayloadTextField {
  readonly get: () => string;
  readonly set: (value: string) => void;
}

function fieldOf(holder: Record<string, unknown>, key: string): PayloadTextField {
  return {
    get: () => holder[key] as string,
    set: (value: string) => {
      holder[key] = value;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function collectPayloadTexts(payload: unknown): PayloadTextField[] {
  if (!isRecord(payload)) {
    return [];
  }
  const fields: PayloadTextField[] = [];

  for (const key of ['instructions', 'input', 'system']) {
    if (typeof payload[key] === 'string') {
      fields.push(fieldOf(payload, key));
    }
  }

  const messages = payload.messages;
  if (!Array.isArray(messages)) {
    return fields;
  }

  for (const message of messages) {
    if (!isRecord(message)) {
      continue;
    }
    if (typeof message.content === 'string') {
      fields.push(fieldOf(message, 'content'));
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (isRecord(part) && part.type === 'text' && typeof part.text === 'string') {
          fields.push(fieldOf(part, 'text'));
        }
      }
    }
    if (Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        if (
          isRecord(call) &&
          isRecord(call.function) &&
          typeof call.function.arguments === 'string'
        ) {
          fields.push(fieldOf(call.function, 'arguments'));
        }
      }
    }
  }

  return fields;
}
