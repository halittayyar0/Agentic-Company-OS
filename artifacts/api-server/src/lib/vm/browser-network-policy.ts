import { BrowserDiagnosticError } from "./browser-diagnostics";
import dns from "node:dns/promises";
import net from "node:net";

const PRIVATE_NETWORKS_ALLOWED =
  process.env.AGENT_BROWSER_ALLOW_PRIVATE_NETWORKS === "true";

const blockedIpv4Networks = new net.BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4Networks.addSubnet(network, prefix, "ipv4");
}

const blockedIpv6Networks = new net.BlockList();
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6Networks.addSubnet(network, prefix, "ipv6");
}

export interface ResolvedBrowserTarget {
  hostname: string;
  address: string;
  family: 4 | 6;
}

export type BrowserDnsLookup = (
  hostname: string,
) => Promise<Array<{ address: string; family: 4 | 6 }>>;

const defaultLookup: BrowserDnsLookup = async (hostname) => {
  const answers = await dns.lookup(hostname, { all: true, verbatim: true });
  return answers.flatMap((answer) =>
    answer.family === 4 || answer.family === 6
      ? [{ address: answer.address, family: answer.family }]
      : [],
  );
};

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateBrowserIp(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const family = net.isIP(normalized);
  if (family === 4) {
    return (
      isPrivateIpv4(normalized) || blockedIpv4Networks.check(normalized, "ipv4")
    );
  }
  if (family === 6) return blockedIpv6Networks.check(normalized, "ipv6");
  return true;
}

/**
 * Resolves once, validates every returned address, and returns the exact IP
 * that the egress proxy must dial. This removes the DNS-check/DNS-use gap that
 * exists when a browser resolves the hostname again after an SSRF check.
 */
export async function resolveSafeBrowserTarget(
  hostname: string,
  lookup: BrowserDnsLookup = defaultLookup,
): Promise<ResolvedBrowserTarget> {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (!normalized || normalized.length > 253) {
    throw new BrowserDiagnosticError("Gecersiz tarayici hedefi.", {
      key: "browserTargetInvalid",
    });
  }
  if (
    !PRIVATE_NETWORKS_ALLOWED &&
    (normalized === "localhost" ||
      normalized.endsWith(".localhost") ||
      normalized.endsWith(".local") ||
      normalized.endsWith(".internal"))
  ) {
    throw new BrowserDiagnosticError(
      "Ozel veya yerel ag hedefleri tarayici guvenlik politikasi tarafindan engellendi.",
      { key: "browserPrivateTarget" },
    );
  }

  const literalFamily = net.isIP(normalized);
  if (literalFamily === 4 || literalFamily === 6) {
    if (!PRIVATE_NETWORKS_ALLOWED && isPrivateBrowserIp(normalized)) {
      throw new BrowserDiagnosticError(
        "Ozel veya yerel IP hedefleri engellendi.",
        { key: "browserPrivateIp" },
      );
    }
    return {
      hostname: normalized,
      address: normalized,
      family: literalFamily,
    };
  }

  const answers = await lookup(normalized);
  if (
    answers.length === 0 ||
    answers.some(
      (answer) =>
        ![4, 6].includes(answer.family) ||
        (!PRIVATE_NETWORKS_ALLOWED && isPrivateBrowserIp(answer.address)),
    )
  ) {
    throw new BrowserDiagnosticError(
      "Hedef alan adi ozel veya yerel bir IP adresine cozuluyor.",
      { key: "browserUnsafeResolution" },
    );
  }
  const selected = answers[0];
  if (!selected)
    throw new BrowserDiagnosticError("Hedef alan adi cozumlenemedi.", {
      key: "browserUnresolved",
    });
  return {
    hostname: normalized,
    address: selected.address,
    family: selected.family,
  };
}

/** Validate a top-level or subresource URL before browser navigation. */
export async function assertSafeBrowserUrl(rawUrl: string): Promise<URL> {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BrowserDiagnosticError(
      "Yalnizca http ve https adreslerine izin verilir.",
      { key: "browserProtocolDenied" },
    );
  }
  if (parsed.username || parsed.password) {
    throw new BrowserDiagnosticError(
      "URL icinde kullanici adi veya parola kullanilamaz.",
      { key: "browserCredentialsDenied" },
    );
  }
  await resolveSafeBrowserTarget(parsed.hostname);
  return parsed;
}
