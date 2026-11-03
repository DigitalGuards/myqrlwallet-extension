// Raw storage oracle for the dApp writers: dApp requests, grants and grant
// revocations.
// Import the oracle first: it registers the storage mocks before
// StorageUtil loads.
import {
  describeWriterOracle,
  resetOracleState,
} from "./__mocks__/storageRawWriterOracle";
import { afterEach } from "vitest";

afterEach(resetOracleState);

describeWriterOracle("dApps");
