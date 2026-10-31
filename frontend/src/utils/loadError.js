// #25/#26: turns the errors thrown by the API helpers into one short,
// readable sentence for the page. Unknown messages are passed through as-is.

const STATUS_AT_END = /:\s*(\d{3})$/; // "Failed to fetch risk data: 503"

export function describeLoadError(err, fallback = "Something went wrong.") {
  if (err?.name === "RequestTimeoutError") {
    return "The server took too long to respond.";
  }

  // fetch() rejects with a TypeError when the server can't be reached at all.
  if (err instanceof TypeError) {
    return "Can't reach the server. Check your connection and try again.";
  }

  const status = Number(STATUS_AT_END.exec(err?.message ?? "")?.[1]);
  if (status === 503) {
    return "The data service is temporarily unavailable.";
  }
  if (status >= 500) {
    return `The server ran into a problem (${status}).`;
  }

  return err?.message || fallback;
}
