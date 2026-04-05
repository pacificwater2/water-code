function serializeError(error) {
  if (error instanceof Error) {
    return {
      message: error.message,
      stack: error.stack || error.message
    };
  }

  return {
    message: String(error)
  };
}

export function createJsonEnvelope(options = {}) {
  return {
    ok: true,
    transport: options.transport || "local",
    cwd: options.cwd || null,
    remoteUrl: options.remoteUrl || null,
    steps: []
  };
}

export function createJsonStep(operation, payload = {}) {
  return {
    operation,
    ...payload
  };
}

export function writeJsonEnvelope(envelope, stream = process.stdout) {
  stream.write(`${JSON.stringify(envelope, null, 2)}\n`);
}

export function writeJsonEvent(event, stream = process.stdout) {
  stream.write(`${JSON.stringify(event)}\n`);
}

export function writeJsonError(error, metadata = {}, stream = process.stderr) {
  const payload = {
    ok: false,
    ...metadata,
    error: serializeError(error)
  };

  stream.write(`${JSON.stringify(payload, null, 2)}\n`);
}
