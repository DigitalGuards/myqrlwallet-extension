import { act } from "@testing-library/react";

// The affirmative button of a dApp prompt ignores input for the first 600 ms.
// Tests that click it wait this out once, in real time.
export const waitOutApprovalProtection = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 650));
  });
};
