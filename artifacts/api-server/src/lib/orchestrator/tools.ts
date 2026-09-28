import type OpenAI from "openai";
import type { Agent } from "@workspace/db";
import { isCanonicalRootCeo } from "./agent-authority";
import { capabilityToolDefinitions } from "../capabilities/capability-tools";
import { readExecutionPolicy, policyAllowsTool } from "../execution-policy";

type ToolDef = OpenAI.Chat.Completions.ChatCompletionTool;

const createSubAgentTool: ToolDef = {
  type: "function",
  function: {
    name: "create_sub_agent",
    description:
      "Kendine bagli yeni bir uzman alt ajan olusturur. Yeni ajan senin departmanindaki bir isi ustlenmek icin kullanilir.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Yeni ajanin adi" },
        role: {
          type: "string",
          description: "Yeni ajanin unvani/rolu, orn. 'Sosyal Medya Uzmani'",
        },
        systemPrompt: {
          type: "string",
          description:
            "Yeni ajanin gorev tanimini ve calisma tarzini anlatan sistem talimati (Turkce veya kullanicinin dilinde).",
        },
      },
      required: ["name", "role", "systemPrompt"],
      additionalProperties: false,
    },
  },
};

const delegateTaskTool: ToolDef = {
  type: "function",
  function: {
    name: "delegate_task",
    description:
      "Var olan bir alt ajana (agentId ile) yeni bir gorev atar. Gorev, senin su an uzerinde calistigin gorevin alt gorevi olarak kaydedilir.",
    parameters: {
      type: "object",
      properties: {
        agentId: {
          type: "number",
          description:
            "Gorevin atanacagi ajanin id'si (senin alt ajanin olmali)",
        },
        title: { type: "string", description: "Gorevin kisa basligi" },
        brief: {
          type: "string",
          maxLength: 8_000,
          description: "Gorevin detayli tanimi ve beklenen sonuc",
        },
        priority: {
          type: "string",
          enum: ["low", "normal", "high", "urgent"],
        },
        autonomyMode: {
          type: "string",
          enum: ["finite", "continuous"],
          description: "Kesintisiz sorumluluklar için continuous kullanılır.",
        },
        cadenceSeconds: {
          type: "number",
          minimum: 60,
          maximum: 604800,
          description: "Continuous görev tekrar aralığı (saniye).",
        },
      },
      required: ["agentId", "title", "brief"],
      additionalProperties: false,
    },
  },
};

const updateTaskProgressTool: ToolDef = {
  type: "function",
  function: {
    name: "update_task_progress",
    description:
      "Uzerinde calistigin mevcut gorevin ilerleme yuzdesini ve durum notunu gunceller.",
    parameters: {
      type: "object",
      properties: {
        progressPercent: { type: "number", minimum: 0, maximum: 100 },
        note: { type: "string", description: "Kisa ilerleme notu" },
      },
      required: ["progressPercent", "note"],
      additionalProperties: false,
    },
  },
};

const completeTaskTool: ToolDef = {
  type: "function",
  function: {
    name: "complete_task",
    description:
      "Uzerinde calistigin mevcut gorevi tamamlandi olarak isaretler. Bir denetim (judge) kontrolunden gecer.",
    parameters: {
      type: "object",
      properties: {
        resultSummary: {
          type: "string",
          description: "Gorevin sonucunun ozeti -- ne yapildi, ne elde edildi",
        },
      },
      required: ["resultSummary"],
      additionalProperties: false,
    },
  },
};

const requestApprovalTool: ToolDef = {
  type: "function",
  function: {
    name: "request_approval",
    description:
      "Harcama, silme, yayinlama veya disariyla iletisim gibi riskli bir eylem icin kullanicidan onay ister. Onay gelene kadar gorev beklemede kalir.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          enum: ["spend", "delete", "publish", "external_contact", "other"],
        },
        title: { type: "string" },
        description: { type: "string" },
        amountUsd: {
          type: "number",
          description: "Harcama kategorisi icin tutar (varsa)",
        },
        toolName: {
          type: "string",
          description:
            "Onaydan sonra calistirilacak arac adi (ornegin browser_type veya browser_click)",
        },
        target: {
          type: "string",
          description:
            "Kullaniciya gosterilecek hedef site, hesap, kaynak veya alici",
        },
        toolArgs: {
          type: "object",
          description:
            "Onaydan sonra araca verilecek argumanlarin tam kopyasi; kapsam hash'i icin kullanilir",
          additionalProperties: true,
        },
      },
      required: ["category", "title", "description"],
      additionalProperties: false,
    },
  },
};

const requestUserInputTool: ToolDef = {
  type: "function",
  function: {
    name: "request_user_input",
    description:
      "Devam edebilmek icin kullanicidan netlestirici bilgi ister. Gorev, cevap gelene kadar 'blocked' durumuna gecer.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", minLength: 1, maxLength: 1000 },
      },
      required: ["question"],
      additionalProperties: false,
    },
  },
};

const logNoteTool: ToolDef = {
  type: "function",
  function: {
    name: "log_note",
    description:
      "Onemli bir bulguyu, karari veya durum guncellemesini organizasyonun aktivite kaydina yazar (rapor niteligindedir).",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string" },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
};

const postCompanyMessageTool: ToolDef = {
  type: "function",
  function: {
    name: "post_company_message",
    description:
      "Yalnizca kurucu ve eklenmis oda uyelerinin gorebildigi kalici Sirket Odasi'na gercek bir koordinasyon mesaji yazar. Bu araci sadece diger oda uyelerinin bilmesi veya yanitlamasi gereken somut bilgi, karar, engel ya da soru icin kullan; rutin ilerlemeyi tekrar etme.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          minLength: 1,
          maxLength: 4000,
          description:
            "Senin adina gorunecek mesaj. Baska bir kisinin soyledigini veya yapilan bir eylemi uydurma.",
        },
        replyToMessageId: {
          type: "number",
          minimum: 1,
          description:
            "Varsa yanit verilen ortak kanal mesajinin sayisal kimligi.",
        },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
};

// --- Sanal bilgisayar (VM) araclari ---------------------------------------

const computerObserveTool: ToolDef = {
  type: "function",
  function: {
    name: "computer_observe",
    description:
      "Ajan bilgisayarinin salt okunur, birlesik canli durumunu gozlemler: etkin yuzey, tarayici URL/baslik/kontrol sahibi, terminal cwd, workspace ozeti ve son tarayici-terminal-dosya gecisleri. Bir yuzeyden digerine gecmeden ve kritik bir iddiadan once kullan.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
};

const vmRunCommandTool: ToolDef = {
  type: "function",
  function: {
    name: "vm_run_command",
    description:
      "KENDI calisma alaninda guvenli dahili dosya komutlarini calistirir (ls/cat/mkdir/write/echo vb.). Host programlari varsayilan olarak kapali; rm/del icin kapsamli silme onayi gerekir.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Calistirilacak komut satiri" },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
};

const vmRunSudoCommandTool: ToolDef = {
  type: "function",
  function: {
    name: "vm_run_sudo_command",
    description:
      "API servis hesabinin host shell yetkileriyle komut onerir (OS root/Administrator yukseltmesi degildir). Komut ajanin calisma alaninda baslar; host dosyalarina ve programlarina erisebilir. Betik/program onaydan sonra degisebilir ve alt surecler timeout'tan uzun yasayabilir. Kimlik bilgisi okuma/disari aktarma ve arka plan sureci yasaktir. HER komut icin ayri, 5 dakikalik, tam komut metnine bagli tek kullanimlik onay zorunludur.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          maxLength: 1000,
          description:
            "Kullanicinin aynen gorecegi ve onaylarsa platform shell ile calistirilacak tam komut",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
};

const vmListFilesTool: ToolDef = {
  type: "function",
  function: {
    name: "vm_list_files",
    description:
      "Kendi sanal bilgisayarinin calisma alanindaki bir dizini listeler.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Goreceli dizin yolu; bos ise kok dizin listelenir.",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

const vmReadFileTool: ToolDef = {
  type: "function",
  function: {
    name: "vm_read_file",
    description: "Kendi sanal bilgisayarindaki bir metin dosyasini okur.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Goreceli dosya yolu" },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
};

const vmWriteFileTool: ToolDef = {
  type: "function",
  function: {
    name: "vm_write_file",
    description:
      "Kendi sanal bilgisayarina metin dosyasi YAZAR veya var olanı gunceller (kod, dokuman, rapor, JSON vb.). Diziler otomatik olusturulur.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Goreceli dosya yolu, orn. raporlar/ozet.md",
        },
        content: { type: "string", description: "Dosyanin tam icerigi" },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
  },
};

// --- Tarayici (computer use) araclari -------------------------------------

const browserOpenTool: ToolDef = {
  type: "function",
  function: {
    name: "browser_open",
    description:
      "KENDI tarayicinda bir web sitesi acar. Sonrasinda otomatik snapshot doner; [ref=N] numaralariyla oge tiklayabilir/doldurabilirsin.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Acilacak adres, orn. example.com",
        },
      },
      required: ["url"],
      additionalProperties: false,
    },
  },
};

const browserSnapshotTool: ToolDef = {
  type: "function",
  function: {
    name: "browser_snapshot",
    description:
      "Tarayicindaki guncel sayfanin ozetini verir: baslik, URL, tiklanabilir oge ref listesi ve gorunur metin.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
};

const browserClickTool: ToolDef = {
  type: "function",
  function: {
    name: "browser_click",
    description:
      "Sayfadaki bir ogeye ref numarasi ile tiklar (link, buton vb.).",
    parameters: {
      type: "object",
      properties: {
        ref: {
          type: "number",
          description: "browser_snapshot'taki ref numarasi",
        },
      },
      required: ["ref"],
      additionalProperties: false,
    },
  },
};

const browserTypeTool: ToolDef = {
  type: "function",
  function: {
    name: "browser_type",
    description:
      "Bir metin kutusuna (ref ile) yazi yazar. Guvenlik icin gonderim ayridir: sonra yeni snapshot al ve gonder dugmesini browser_click ile ayri onaya sun.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "number" },
        text: { type: "string", description: "Kutuya yazilacak metin" },
        submit: {
          type: "boolean",
          description:
            "Guvenlik nedeniyle false olmali; gonderim ayri browser_click onayi ister",
        },
      },
      required: ["ref", "text"],
      additionalProperties: false,
    },
  },
};

const browserScrollTool: ToolDef = {
  type: "function",
  function: {
    name: "browser_scroll",
    description: "Sayfayi yukari veya asagi kaydirir.",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["up", "down"] },
      },
      required: ["direction"],
      additionalProperties: false,
    },
  },
};

const browserExtractTool: ToolDef = {
  type: "function",
  function: {
    name: "browser_extract_text",
    description:
      "Sayfanin gorunur tum metnini cikarir (uzerinde arastirma yaparken kullan).",
    parameters: {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
};

const browserWaitTool: ToolDef = {
  type: "function",
  function: {
    name: "browser_wait",
    description:
      "Dinamik sayfanin gercekten guncellenmesi icin 250-5000 ms bekler ve ardindan yeni snapshot doner. Sabit tekrar yerine yalnizca sayfa gecikmeli yukleniyorsa kullan.",
    parameters: {
      type: "object",
      properties: {
        milliseconds: {
          type: "number",
          minimum: 250,
          maximum: 5000,
          description: "Bekleme suresi (milisaniye)",
        },
      },
      required: ["milliseconds"],
      additionalProperties: false,
    },
  },
};

const browserSaveScreenshotTool: ToolDef = {
  type: "function",
  function: {
    name: "browser_save_screenshot",
    description:
      "Tarayicinin o anki gercek PNG goruntusunu ajanin workspace'ine kanit artefakti olarak kaydeder; dosya yolunu, boyutu, URL'yi ve basligi dondurur.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          maxLength: 120,
          description:
            "Opsiyonel dosya adi (orn. sonuc.png); guvensiz karakterler temizlenir",
        },
      },
      required: [],
      additionalProperties: false,
    },
  },
};

import { readCapabilityPacks, toolPack } from "../capabilities/extension-store";

export async function getToolsForAgent(
  agent: Agent,
  hasActiveTask: boolean,
): Promise<ToolDef[]> {
  const permissions = agent.permissions;
  // Approval is also available in direct chat. If no task exists, the
  // executor creates a tracked awaiting-approval task before recording it.
  const tools: ToolDef[] = [
    ...capabilityToolDefinitions,
    logNoteTool,
    postCompanyMessageTool,
    requestApprovalTool,
  ];

  if (permissions.canUseTerminal || permissions.canBrowse) {
    tools.push(computerObserveTool);
  }

  if (permissions.canCreateSubAgents) tools.push(createSubAgentTool);
  if (permissions.canDelegate) tools.push(delegateTaskTool);

  if (permissions.canUseTerminal) {
    tools.push(
      vmRunCommandTool,
      vmListFilesTool,
      vmReadFileTool,
      vmWriteFileTool,
    );
  }

  if (permissions.canUseSudo && (await isCanonicalRootCeo(agent))) {
    tools.push(vmRunSudoCommandTool);
  }

  if (permissions.canBrowse) {
    tools.push(
      browserOpenTool,
      browserSnapshotTool,
      browserClickTool,
      browserTypeTool,
      browserScrollTool,
      browserExtractTool,
      browserWaitTool,
      browserSaveScreenshotTool,
    );
  }

  if (hasActiveTask) {
    tools.push(updateTaskProgressTool, completeTaskTool, requestUserInputTool);
  }

  const policy = await readExecutionPolicy();
  const packs = await readCapabilityPacks();
  return tools.filter(
    (tool) =>
      tool.type === "function" &&
      policyAllowsTool(policy, tool.function.name) &&
      (!toolPack(tool.function.name) ||
        packs.enabledPacks.includes(toolPack(tool.function.name)!)),
  );
}
