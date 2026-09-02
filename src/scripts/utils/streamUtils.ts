import { ObjectMultiplex } from "@theqrl/qrl-wallet-provider/object-multiplex";
import type { ExtensionPortStream } from "extension-port-stream";
import { pipeline } from "readable-stream";

// Sets up stream multiplexing for the given stream
export function setupMultiplex(connectionStream: ExtensionPortStream) {
  const mux = new ObjectMultiplex();
  pipeline(connectionStream, mux, connectionStream, (err: Error | null) => {
    if (err && !err.message?.match("Premature close")) {
      console.error(err);
    }
  });
  return mux;
}
