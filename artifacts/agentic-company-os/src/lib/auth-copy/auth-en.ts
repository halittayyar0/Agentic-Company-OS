import type { AuthCopy } from "../auth-copy";

const copy = {
  badge: "Secure operator sign in",
  title: "Access AgenticOS",
  description:
    "This installation is protected by an access key. The key is used only to establish a secure session.",
  accessKey: "Access key",
  invalidSession: "Session could not be verified. Try again.",
  loginFailed: "Sign in failed.",
  verifying: "Verifying…",
  signIn: "Sign in securely",
  checkingSession: "Verifying your secure session…",
  serviceUnavailable: "Session service unavailable",
  serviceUnavailableDescription:
    "The workspace stays closed until its security state can be verified.",
  retry: "Try again",
  invalidKey: "Invalid access key.",
} satisfies AuthCopy;

export default copy;
