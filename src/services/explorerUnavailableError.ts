/**
 * The explorer could not tell the wallet what an account holds: it is
 * unreachable, slow, answered with an error status, or answered with
 * something that is not the expected JSON. Raised only where the caller
 * must tell "unknown" apart from "nothing".
 */
export class ExplorerUnavailableError extends Error {
  constructor() {
    super("The explorer did not answer");
    this.name = "ExplorerUnavailableError";
  }
}
