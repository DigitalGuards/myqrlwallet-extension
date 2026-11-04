// Raw storage oracle for the transaction writers: transaction drafts and
// transaction history.
// Import the oracle first: it registers the storage mocks before
// StorageUtil loads.
import {
  describeWriterOracle,
  resetOracleState,
} from "./__mocks__/storageRawWriterOracle";
import { afterEach } from "vitest";

afterEach(resetOracleState);

describeWriterOracle("transactions");
