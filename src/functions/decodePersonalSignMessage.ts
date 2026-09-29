import { hexToBytes } from "@theqrl/web3-utils";
import { isHexStrict } from "@theqrl/web3-validator";

export type PersonalSignMessage = {
  /** Exactly the bytes that get signed, read as UTF-8. */
  text: string;
  /** True when the raw request was hex and was decoded for display. */
  wasHexDecoded: boolean;
};

/**
 * Renders a personal_sign payload the way it will be signed.
 *
 * `@theqrl/web3-qrl-accounts`'s hashMessage hex-decodes its input only when
 * it is 0x-prefixed (isHexStrict) and treats everything else as UTF-8 text.
 * A display that decoded unprefixed hex too showed the user one message
 * while the wallet signed another: "48656c6c6f" was shown as "Hello" and
 * signed as the ten literal characters. The rule here is deliberately the
 * same one hashMessage applies, so what is shown is what is signed.
 */
export function decodePersonalSignMessage(
  rawMessage: string,
): PersonalSignMessage {
  if (!isHexStrict(rawMessage)) {
    return { text: rawMessage, wasHexDecoded: false };
  }
  try {
    return {
      text: new TextDecoder().decode(hexToBytes(rawMessage)),
      wasHexDecoded: true,
    };
  } catch {
    // Undecodable hex: show the request verbatim, so the box is never
    // empty.
    return { text: rawMessage, wasHexDecoded: false };
  }
}
