import type { ExtensionEditorCopy } from "../extension-editor-copy";
export default {
  storageError:
    "此分頁無法保留或清除草稿或儲存紀錄。可編輯文字仍在這裡；重新整理可能遺失未儲存的修改。只有請求成功保留後才會開始儲存。",
  pendingTitle: "再次儲存前，請檢查此次儲存",
  uncertain: "儲存回應尚未確認。保留相同指南識別碼和已提交版本；不會自動重試。",
  check: "檢查已儲存內容",
  retry: "重試已提交的儲存",
  continue: "繼續編輯",
  matching:
    "目前儲存的識別碼、內容、可用狀態和版本與提交內容一致。這是內容檢查，不是命令回執。",
  missing:
    "此次讀取未找到新的已儲存版本。首次請求仍可能完成。重試將送出相同識別碼、內容和預期版本。",
  changed: "已儲存指南與此次提交不同。繼續前請查看已儲存內容；不會重試儲存。",
  invalid: "無法驗證已儲存內容。已提交紀錄仍保留在這裡。連線可用後請再次檢查。",
  validation:
    "儲存前請修正識別碼和必填欄位：標題最多 120 個字元，說明 2,000，指令或程式碼 8,000，JSON 套件 16,000。工具預設值必須是 JSON 物件。文字不會自動縮短。",
  availability: "儲存後供代理使用",
  incomingHelp:
    "你已有可編輯草稿。可以保留它，或明確替換為選取的指南或匯入內容。",
  keep: "保留目前編輯器草稿",
  use: "使用選取的指南",
  reviewCurrent: "保留我的修改並採用已儲存版本",
  storedVersion: "目前已儲存指南",
  storedAvailability: "已儲存版本可供代理使用",
  reviewHelp:
    "請查看下方已儲存文字。繼續會保留可編輯文字，並為之後明確執行的儲存採用此次讀取的版本。不會授予新權限。",
} satisfies ExtensionEditorCopy;
