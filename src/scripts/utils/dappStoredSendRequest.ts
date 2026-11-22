import { hasInputField, UNREAD_INPUT_MESSAGE } from "./dappTransactionCallData";
import {
  isSupportedTransactionType,
  unsupportedTransactionTypeMessage,
} from "./dappTransactionType";

/**
 * What is wrong with a send request as it was stored for the approval, if
 * anything is. The service worker refuses another transaction type before
 * the prompt and stores a request with its call data as `data`
 * (sendTransactionParamsForApproval). A stored request that names another
 * type, or that still names `input`, did not come that way: the library
 * would refuse the first after the approval, and the second would be shown
 * and signed without its call data. The approval shows such a request as
 * one it cannot read and does not sign it.
 */
export const storedSendRequestProblem = (
  transaction: unknown,
): string | undefined => {
  if (hasInputField(transaction)) return UNREAD_INPUT_MESSAGE;
  const type: unknown =
    typeof transaction === "object" && transaction !== null
      ? Reflect.get(transaction, "type")
      : undefined;
  return isSupportedTransactionType(type)
    ? undefined
    : unsupportedTransactionTypeMessage(type);
};
