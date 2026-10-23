import type { ModelPreparationCopy } from "../local-model-preparation-copy";
export default {
  pendingHint: "已在等待此模型的任务可能继续执行。",
  title: "获取本地模型",
  description: "将小型入门模型下载到已保存的 Ollama 服务器。",
  download: "下载模型",
  stop: "停止下载",
  checking: "正在检查已下载的模型",
  returnToJob: "返回我的任务",
  available: "本地模型已可用",
  preparing: "正在准备下载",
  downloading: "正在下载模型文件",
  stopping: "正在停止此下载请求",
  interrupted: "下载已中断。重试前请检查模型。服务器上可能保留部分文件。",
  failed: "无法验证下载结果。重试前请检查服务器。",
  unknown: "无法确认下载请求是否已收到。重试前请检查状态或停止此请求。",
  check: "检查下载",
  install: "安装或更新 Ollama",
  where: "请选择实际运行模型的电脑或服务器的操作系统。",
  storage:
    "模型文件约 2 GB，临时文件还需要额外空间。使用已连接电脑或服务器的网络和磁盘，不占用手机存储空间。",
  saveFirst: "下载前请保存并检查服务器地址。",
  continues:
    "下载期间可以关闭此窗口。停止操作仅影响此请求；其他客户端的下载可能继续。",
  reset: "服务器重新开始了部分传输。已观察到的字节数减少。",
  unavailable:
    "无法连接 Ollama。请在实际运行模型的电脑或服务器上安装或启动它，然后重新检查。",
  update:
    "此入门模型需要 Ollama 0.40.3 或更高版本。请更新已连接的服务器，然后重新检查。",
  changed: "已保存的连接发生了变化。再次下载前请检查当前服务器。",
  readyHint: "返回草稿，自行决定何时开始。已在等待此模型的任务可能继续执行。",
  bytes: "已观察到的模型数据",
} satisfies ModelPreparationCopy;
