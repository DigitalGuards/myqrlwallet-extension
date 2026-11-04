// Raw storage oracle for the account writers: account lists, the active
// account, per-account wipes and Ledger accounts.
// Import the oracle first: it registers the storage mocks before
// StorageUtil loads.
import {
  describeWriterOracle,
  resetOracleState,
} from "./__mocks__/storageRawWriterOracle";
import { afterEach } from "vitest";

afterEach(resetOracleState);

describeWriterOracle("accounts");
