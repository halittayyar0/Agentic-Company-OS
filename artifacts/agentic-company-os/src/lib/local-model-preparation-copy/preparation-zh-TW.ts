import type { ModelPreparationCopy } from "../local-model-preparation-copy";
export default {
  pendingHint: "已在等待此模型的工作可能繼續執行。",
  title: "取得本機模型",
  description: "將小型入門模型下載至已儲存的 Ollama 伺服器。",
  download: "下載模型",
  stop: "停止下載",
  checking: "正在檢查已下載的模型",
  returnToJob: "返回我的工作",
  available: "本機模型已可用",
  preparing: "正在準備下載",
  downloading: "正在下載模型檔案",
  stopping: "正在停止此下載要求",
  interrupted: "下載已中斷。重試前請檢查模型。伺服器上可能保留部分檔案。",
  failed: "無法驗證下載結果。重試前請檢查伺服器。",
  unknown: "無法確認下載要求是否已收到。重試前請檢查狀態或停止此要求。",
  check: "檢查下載",
  install: "安裝或更新 Ollama",
  where: "請選擇實際執行模型的電腦或伺服器所使用的作業系統。",
  storage:
    "模型檔案約 2 GB，暫存檔案還需要額外空間。使用已連接電腦或伺服器的網路與磁碟，不佔用手機儲存空間。",
  saveFirst: "下載前請儲存並檢查伺服器位址。",
  continues:
    "下載期間可以關閉此視窗。停止操作僅影響此要求；其他用戶端的下載可能繼續。",
  reset: "伺服器重新開始了部分傳輸。已觀察到的位元組數減少。",
  unavailable:
    "無法連線至 Ollama。請在實際執行模型的電腦或伺服器上安裝或啟動它，然後重新檢查。",
  update:
    "此入門模型需要 Ollama 0.40.3 或更新版本。請更新已連接的伺服器，然後重新檢查。",
  changed: "已儲存的連線已變更。再次下載前請檢查目前的伺服器。",
  readyHint: "返回草稿，自行決定何時開始。已在等待此模型的工作可能繼續執行。",
  bytes: "已觀察到的模型資料",
} satisfies ModelPreparationCopy;
