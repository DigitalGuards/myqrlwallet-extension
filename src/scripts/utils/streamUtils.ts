import { ObjectMultiplex } from "@theqrl/qrl-wallet-provider/object-multiplex";
import type { ExtensionPortStream } from "extension-port-stream";
import { pipeline } from "readable-stream";

/**
 * True for the error a stream pipeline reports when its port closes under
 * it: a tab closing, navigating or entering the back/forward cache. That is
 * the normal end of a dApp connection and is not worth a console entry.
 */
export const isPrematureClose = (error: unknown) =>
  error instanceof Error && /Premature close/.test(error.message);

// Sets up stream multiplexing for the given stream
export function setupMultiplex(connectionStream: ExtensionPortStream) {
  const mux = new ObjectMultiplex();
  pipeline(connectionStream, mux, connectionStream, (err: Error | null) => {
    if (err && !isPrematureClose(err)) {
      console.error(err);
    }
  });
  return mux;
}
