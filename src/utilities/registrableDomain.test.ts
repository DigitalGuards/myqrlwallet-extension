import { describe, expect, it } from "vitest";
import { registrableDomain } from "./registrableDomain";

describe("registrableDomain", () => {
  describe("plain hosts", () => {
    it("returns a two-label host unchanged", () => {
      expect(registrableDomain("qrlwallet.com")).toBe("qrlwallet.com");
    });

    it("keeps a multi-label TLD-only host as it is", () => {
      expect(registrableDomain("theqrl.org")).toBe("theqrl.org");
    });
  });

  describe("subdomains", () => {
    it("drops a single subdomain", () => {
      expect(registrableDomain("dev.qrlwallet.com")).toBe("qrlwallet.com");
    });

    it("drops a deep subdomain chain", () => {
      expect(registrableDomain("a.b.c.d.zondscan.com")).toBe("zondscan.com");
    });

    it("drops www", () => {
      expect(registrableDomain("www.quantaswap.io")).toBe("quantaswap.io");
    });
  });

  describe("spoofing shapes", () => {
    it("surfaces the attacker label for a trustworthy-looking prefix", () => {
      expect(registrableDomain("qrlwallet.com.attacker.example")).toBe(
        "attacker.example",
      );
    });

    it("surfaces the attacker label for a long padded hostname", () => {
      expect(
        registrableDomain(
          "qrlwallet.com.secure.login.verify.account.attacker-controlled-domain.example",
        ),
      ).toBe("attacker-controlled-domain.example");
    });

    it("accepts a full URL and reads its hostname", () => {
      expect(
        registrableDomain("https://qrlwallet.com.attacker.example/approve?a=1"),
      ).toBe("attacker.example");
    });
  });

  describe("multi-part public suffixes", () => {
    it("takes three labels for a country-code second-level domain", () => {
      expect(registrableDomain("shop.example.co.uk")).toBe("example.co.uk");
    });

    it("takes three labels for com.au", () => {
      expect(registrableDomain("example.com.au")).toBe("example.com.au");
    });

    it("keeps the project label on a platform suffix", () => {
      expect(registrableDomain("myproject.github.io")).toBe(
        "myproject.github.io",
      );
      expect(registrableDomain("docs.myproject.github.io")).toBe(
        "myproject.github.io",
      );
      expect(registrableDomain("dapp.pages.dev")).toBe("dapp.pages.dev");
      expect(registrableDomain("api.dapp.workers.dev")).toBe(
        "dapp.workers.dev",
      );
    });

    it("prefers the longest matching suffix", () => {
      expect(registrableDomain("site.on.fleek.co")).toBe("site.on.fleek.co");
      expect(registrableDomain("cid.ipfs.dweb.link")).toBe(
        "cid.ipfs.dweb.link",
      );
    });

    it("returns the suffix itself when there is no label in front of it", () => {
      expect(registrableDomain("co.uk")).toBe("co.uk");
      expect(registrableDomain("github.io")).toBe("github.io");
    });
  });

  describe("IP literals and localhost", () => {
    it("returns an IPv4 literal unchanged", () => {
      expect(registrableDomain("203.0.113.7")).toBe("203.0.113.7");
    });

    it("returns a bracketed IPv6 literal unchanged", () => {
      expect(registrableDomain("[2001:db8::1]")).toBe("[2001:db8::1]");
      expect(registrableDomain("http://[::1]:8545/")).toBe("[::1]");
    });

    it("returns localhost unchanged", () => {
      expect(registrableDomain("localhost")).toBe("localhost");
      expect(registrableDomain("http://localhost:5173/")).toBe("localhost");
    });
  });

  describe("normalisation", () => {
    it("strips a trailing dot", () => {
      expect(registrableDomain("dev.qrlwallet.com.")).toBe("qrlwallet.com");
    });

    it("lowercases", () => {
      expect(registrableDomain("DEV.QrlWallet.COM")).toBe("qrlwallet.com");
    });

    it("trims surrounding whitespace", () => {
      expect(registrableDomain("  qrlwallet.com  ")).toBe("qrlwallet.com");
    });
  });

  describe("unparseable input", () => {
    it("returns an empty string unchanged", () => {
      expect(registrableDomain("")).toBe("");
      expect(registrableDomain("   ")).toBe("   ");
    });

    it("returns text with spaces unchanged", () => {
      expect(registrableDomain("not a hostname")).toBe("not a hostname");
    });

    it("returns a malformed URL unchanged", () => {
      expect(registrableDomain("https://")).toBe("https://");
    });

    it("returns a host with empty labels unchanged apart from case", () => {
      expect(registrableDomain("a..b")).toBe("a..b");
    });

    it("returns garbage unchanged", () => {
      expect(registrableDomain("!!!")).toBe("!!!");
    });
  });
});
