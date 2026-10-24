// #25: a slow backend must not leave the page stuck on "Loading...".

export const REQUEST_TIMEOUT_MS = 15000;

export class RequestTimeoutError extends Error {
  constructor(timeoutMs) {
    super(`The request timed out after ${Math.round(timeoutMs / 1000)} seconds`);
    this.name = "RequestTimeoutError";
  }
}

// Rejects with RequestTimeoutError if `promise` hasn't settled in time.
// (The underlying fetch is not aborted; the page just stops waiting for it.)
export function withTimeout(promise, timeoutMs = REQUEST_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new RequestTimeoutError(timeoutMs)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
