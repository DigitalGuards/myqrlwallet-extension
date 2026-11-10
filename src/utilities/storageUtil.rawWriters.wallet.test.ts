// Raw storage oracle for the wallet writers: keystores, lock timestamps,
// settings, the price cache, the active page and the full wipe.
// Import the oracle first: it registers the storage mocks before
// StorageUtil loads.
import {
  describeWriterOracle,
  resetOracleState,
} from "./__mocks__/storageRawWriterOracle";
import { afterEach } from "vitest";

afterEach(resetOracleState);

describeWriterOracle("wallet");
