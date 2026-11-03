/**
 * Navigation state for Home. The account list's "Create or import an account"
 * button opens Home with the "Add accounts" section first, so the create and
 * import choices are the first thing on screen.
 */
export const ADD_ACCOUNTS_FIRST = { addAccountsFirst: true } as const;

export function wantsAddAccountsFirst(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    "addAccountsFirst" in state &&
    state.addAccountsFirst === true
  );
}
