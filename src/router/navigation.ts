/**
 * A hook the router registers so that code outside the route tree can show
 * the transaction history. The router module imports the wallet screens,
 * so those screens must not import it back.
 */
let showHistory: (() => void) | undefined;

export const registerShowTransactionHistory = (show: () => void): void => {
  showHistory = show;
};

export const showTransactionHistory = (): void => {
  showHistory?.();
};
