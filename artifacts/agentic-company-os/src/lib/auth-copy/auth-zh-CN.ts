import type { AuthCopy } from "../auth-copy";

const copy = {
  badge: "安全的管理员登录",
  title: "进入 AgenticOS",
  description: "此安装受到访问密钥保护。密钥仅用于建立安全会话。",
  accessKey: "访问密钥",
  invalidSession: "无法验证会话，请重试。",
  loginFailed: "登录失败。",
  verifying: "正在验证…",
  signIn: "安全登录",
  checkingSession: "正在验证安全会话…",
  serviceUnavailable: "会话服务不可用",
  serviceUnavailableDescription: "验证安全状态之前，工作区将保持关闭。",
  retry: "重试",
  invalidKey: "访问密钥无效。",
} satisfies AuthCopy;

export default copy;
