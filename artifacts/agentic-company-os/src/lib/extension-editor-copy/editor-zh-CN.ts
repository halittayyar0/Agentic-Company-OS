import type { ExtensionEditorCopy } from "../extension-editor-copy";
export default {
  rejected:
    "服务器拒绝了此次保存。继续编辑会保留文字和指南 ID。再次保存前，请检查字段、支持的工具及已安装指南数量上限。",
  storageError:
    "此标签页无法保留或清除草稿或保存记录。可编辑文本仍在这里；刷新可能丢失未保存的修改。只有请求成功保留后才会开始保存。",
  pendingTitle: "再次保存前，请检查此次保存",
  uncertain: "保存响应尚未确认。保留同一指南标识和已提交版本；不会自动重试。",
  check: "检查已保存内容",
  retry: "重试已提交的保存",
  continue: "继续编辑",
  matching:
    "当前保存的标识、内容、可用状态和版本与提交内容一致。这是内容检查，不是命令回执。",
  missing:
    "此次读取未找到新的已保存版本。首次请求仍可能完成。重试将发送相同标识、内容和预期版本。",
  changed: "已保存指南与此次提交不同。继续前请查看已保存内容；不会重试保存。",
  invalid: "无法验证已保存内容。已提交记录仍保留在这里。连接可用后请再次检查。",
  validation:
    "保存前请修正标识和必填字段：标题最多 120 个字符，说明 2,000，指令或代码 8,000，JSON 包 16,000。工具默认值必须是 JSON 对象。文本不会自动缩短。",
  availability: "保存后供智能体使用",
  incomingHelp:
    "你已有可编辑草稿。可以保留它，或明确替换为选中的指南或导入内容。",
  keep: "保留当前编辑器草稿",
  use: "使用选中的指南",
  reviewCurrent: "保留我的修改并采用已保存版本",
  storedVersion: "当前已保存指南",
  storedAvailability: "已保存版本可供智能体使用",
  reviewHelp:
    "请查看下方已保存文本。继续会保留可编辑文本，并为之后明确执行的保存采用此次读取的版本。不会授予新权限。",
} satisfies ExtensionEditorCopy;
