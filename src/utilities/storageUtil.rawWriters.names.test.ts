// Raw storage oracle for the name writers: account labels, hidden accounts
// and contacts.
// Import the oracle first: it registers the storage mocks before
// StorageUtil loads.
import {
  describeWriterOracle,
  resetOracleState,
} from "./__mocks__/storageRawWriterOracle";
import { afterEach } from "vitest";

afterEach(resetOracleState);

describeWriterOracle("names");
