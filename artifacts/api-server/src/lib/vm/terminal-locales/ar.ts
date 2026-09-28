import type { TerminalCopy } from "../terminal-copy";

export const terminalAr = {
  emptyDirectory: "(فارغ)",
  usageCat: "الاستخدام: cat <ملف>",
  usageMkdir: "الاستخدام: mkdir <مجلد>",
  usageTouch: "الاستخدام: touch <ملف>",
  usageWrite: "الاستخدام: write <ملف> <محتوى>",
  usageRemove: "الاستخدام: rm <مسار>",
  written: "تمت كتابة {path} ({bytes} بايت)",
  removed: "تم حذف {path}",
  helpBuiltins: "الأوامر المدمجة:",
  helpProcessesEnabled:
    "البرامج الخارجية مفعلة: {commands}. مجلد العمل ضمن مساحة الوكيل؛ يمكن لهذه البرامج الوصول إلى النظام المضيف. يجب توفير العزل بواسطة حاوية منفصلة أو آلة افتراضية (VM).",
  helpProcessesDisabled:
    "البرامج الخارجية معطلة: {commands}. لا تفعلها باستخدام ALLOW_AGENT_PROCESS_EXEC=true إلا داخل حاوية معزولة أو آلة افتراضية (VM)؛ قائمة الأوامر ليست حاجزا أمنيا.",
  helpDeleteReview:
    "يحذف rm/del مباشرة. لمراجعة النسخة قبل الحذف، استخدم مسار الحذف في شاشة الملفات.",
  emptyCommand: "الأمر فارغ.",
  forbiddenCommand:
    "تم حظر الأمر لأسباب أمنية: لا يسمح بإعادة توجيه الصدفة أو تسلسل الأوامر أو علامات الاقتباس أو الشرطة المائلة العكسية أو فواصل الأسطر.",
  commandNotAllowed: 'الأمر غير مسموح: "{command}". استخدم help لعرض القائمة.',
  processDisabled:
    "تشغيل البرامج الخارجية معطل افتراضيا. استخدم أوامر الملفات أو اضبط ALLOW_AGENT_PROCESS_EXEC=true فقط داخل حاوية معزولة أو آلة افتراضية (VM).",
  queuedCancelled: "تم إلغاء أمر الوكيل المنتظر بسبب الإيقاف الطارئ.",
  invalidWorkspace: "معرف مساحة العمل غير صالح.",
  unsafePath: 'تم رفض مسار غير آمن: "{path}"',
  regularFileReadOnly: "يمكن قراءة الملفات العادية فقط.",
  readLimit: "يتجاوز الملف الحد المسموح للقراءة.",
  workspaceSymlink: "لا يمكن أن تكون مساحة عمل الوكيل رابطا رمزيا.",
  pathSymlink: "تم رفض مسار رابط رمزي: {path}",
  directoryMissing: "المجلد غير موجود: {path}",
  directoryUnreadable: "تعذرت قراءة المجلد: {path}",
  filePathRequired: "مسار الملف مطلوب.",
  fileMissing: "الملف غير موجود: {path}",
  fileUnreadable: "تعذرت قراءة الملف: {path}",
  rootReplaceDenied: "لا يمكن استبدال جذر مساحة العمل بملف.",
  contentTooLarge: "المحتوى كبير جدا (الحد {bytes} بايت).",
  binaryTooLarge: "المحتوى الثنائي كبير جدا (الحد {bytes} بايت).",
  pathRequired: "المسار مطلوب.",
  rootDeleteDenied: "لا يمكن حذف جذر مساحة العمل.",
  rootNotFile: "جذر مساحة العمل ليس ملفا.",
  regularFileTouchOnly: "يمكن تطبيق touch على الملفات العادية فقط.",
  fileChanged: "تغير الملف بعد المراجعة. راجع النسخة الجديدة.",
  fileNotEditable: "لا يمكن تعديل هذا الملف ضمن هذا المسار.",
  fileVersionRequired: "يتطلب التعديل نسخة من الملف تمت مراجعتها.",
  deleteChanged: "تغير المحتوى المحدد للحذف بعد المراجعة. راجعه مجددا.",
  deleteMissing: "لم يعد المحتوى المحدد للحذف موجودا.",
  deleteNotReviewable: "يتجاوز المحتوى المحدد للحذف حدود المراجعة الآمنة.",
  deleteVersionRequired:
    "يتطلب الحذف نسخة تمت مراجعتها. استخدم مراجعة الحذف في شاشة الملفات.",
  commandRequired: "الحقل command مطلوب.",
  sudoCommandTooLong: "يجب ألا يتجاوز أمر sudo عدد {limit} محرفا.",
  sudoCommandControls:
    "لا يمكن أن يحتوي أمر sudo على محارف تحكم ASCII أو محارف Unicode للتحكم في اتجاه النص.",
  sudoWorkspaceSymlink: "لا يمكن أن تكون مساحة عمل sudo للوكيل رابطا رمزيا.",
  sudoDisabled: "sudo للوكيل معطل (يتطلب التفعيل ALLOW_AGENT_SUDO=true).",
  sudoAuthorityDenied:
    "تم رفض صلاحية sudo للوكيل أثناء التحقق من بيانات الهوية الحالية.",
  sudoTargetUnverified: "تعذر التحقق من مساحة العمل الفعلية لـ sudo الوكيل.",
  sudoTargetMismatch: "لم تتطابق رابطة sudo الوكيل بالمضيف ومساحة العمل.",
  sudoAuthorityChanged:
    "تم رفض صلاحية sudo للوكيل بعد اجتياز نقطة بدء التأثير.",
  sudoTargetRecheckFailed:
    "تعذر إعادة التحقق من مساحة العمل الفعلية لـ sudo الوكيل.",
  sudoTargetChanged:
    "لم تتطابق رابطة sudo الوكيل بالمضيف ومساحة العمل بعد اجتياز نقطة بدء التأثير.",
  founderDisabled:
    "Founder shell معطل (يتطلب التفعيل ALLOW_FOUNDER_SHELL=true).",
  terminalPermissionDenied: "خطأ: لا يملك هذا الوكيل إذن الطرفية الافتراضية.",
  errorPrefix: "خطأ: {message}",
  approvalRequired:
    "محظور: يتطلب {toolName} موافقة من المستخدم محددة النطاق وتستخدم مرة واحدة. استدع أداة request_approval بهذه البيانات: category={category}, toolName={toolName}, toolArgs={args}. لا تحاول تنفيذ هذا الإجراء أو ما يعادله حتى تحصل على الموافقة.",
  sudoRootOnly: "محظور: CEO Host Shell متاح فقط لوكيل CEO الجذري.",
  sudoPermissionDenied:
    "محظور: لا يملك وكيل CEO الجذري إذن واجهة أوامر المضيف.",
  sudoApprovalRequired:
    "محظور: يتطلب vm_run_sudo_command موافقة منفصلة من المستخدم تستخدم مرة واحدة لكل أمر بنصه الكامل والدقيق. استدع أداة request_approval مع toolName=vm_run_sudo_command ونفس قيمة command المقترحة ضمن toolArgs؛ ينشئ الخادم بنفسه نص الموافقة الحرجة والهدف. توقف حتى تحصل على الموافقة.",
  terminalDispatch: "جار إرسال أمر الطرفية",
  sudoDispatch: "جار إرسال أمر الطرفية الموافق عليه",
  terminalExecuted: "نفذ {name} الأمر {command} على حاسوبه الافتراضي.",
  terminalFailed: "واجه {name} خطأ في أمر الطرفية.",
  sudoExecuted:
    "تم تنفيذ أمر CEO Host Shell الموافق عليه لـ {name} (exitCode={exitCode}).",
  sudoFailed: "واجه {name} خطأ في أمر الطرفية الموافق عليه.",
  terminalFailureFallback: "فشل أمر الطرفية",
  sudoFailureFallback: "فشل أمر الطرفية الموافق عليه",
  terminalError: "خطأ في الطرفية: {message}",
  noOutput: "(لا توجد مخرجات)",
  interrupted: "(تمت مقاطعة الأمر قبل اكتماله)",
  exitCode: "(رمز الخروج: {code})",
  note: " [ملاحظة: {note}]",
  operatorComplete: "اكتمل طلب المشغل",
  operatorReview: "تتطلب نتيجة طلب المشغل المراجعة",
  invalidToolJson: "خطأ: تحتوي وسائط الأداة على JSON غير صالح.",
  invalidToolObject: "خطأ: يجب أن تكون وسائط الأداة كائن JSON.",
  exclusiveTools:
    "محظور: {toolName} ليس ضمن الأدوات المسموح بها في هذه الجولة. الأدوات المسموح بها: {tools}. لا تحاول تنفيذ الإجراء نفسه بطريقة أخرى.",
  exclusiveSudoMismatch:
    "محظور: لا تطابق قيمة command نص الأمر الدقيق الذي حدده المستخدم. لا تغير الأمر ولا تنفذ ما يعادله.",
  emergencyBlocked:
    "محظور: تم تفعيل الإيقاف الطارئ أو تغيرت حالته أثناء التنفيذ؛ تم إيقاف عملية الطرفية.",
  agentInactive: "محظور: تم تعطيل الوكيل؛ لم يتم تشغيل الأداة.",
  categoryRevoked:
    "محظور: تم سحب صلاحية الوكيل لفئة الموافقة؛ لم يتم تنفيذ الإجراء.",
  taskLeaseMissing: "محظور: صلاحية تنفيذ المهمة مفقودة؛ لم يتم تشغيل الأداة.",
  taskLeaseLost:
    "محظور: تم إيقاف المهمة أو فقدان صلاحية التنفيذ المتعلقة بالمهمة أو الوكيل أو المحاولة.",
  operationLeaseLost: "محظور: تم فقدان صلاحية تنفيذ استدعاء العملية.",
  taskBoundary: "حد الأداة · {tool}",
  computerBoundary: "خطوة الحاسوب · {tool}",
  computerStarted: "بدأ {name} خطوة على الحاسوب: {tool}.",
  stepStart: "بدء",
  replayComplete:
    "اكتملت العملية سابقا؛ لم يتم تنفيذ التأثير الخارجي مجددا.{evidence}",
  safeEvidence: " دليل آمن: {data}.",
  receiptUnknown:
    "نتيجة العملية غير مؤكدة؛ تم حظر التكرار التلقائي. Receipt: {id}.",
  receiptFailed: "تم إغلاق العملية نهائيا بحالة فشل. Receipt: {id}.",
  receiptBusy: "ينفذ عامل آخر العملية المنطقية نفسها. Receipt: {id}.",
  effectFailure:
    "تعذر إكمال العملية بأمان؛ لم يتم تسجيل الخطأ الخام أو المخرجات.",
  approvedAction: "إجراء موافق عليه · {tool}",
  approvedScopeInvalid: "خطأ: تعذر التحقق من سلامة نطاق الإجراء الموافق عليه.",
  approvedAgentMissing:
    "خطأ: لم يتم العثور على وكيل الإجراء الموافق عليه أو أنه غير نشط.",
  computerSelected: "اختار {name} خطوة الحاسوب التالية: {tool}.",
  computerDeferred:
    "مؤجل: لا يمكن تنفيذ {tool} بأمان قبل الاطلاع على نتيجة خطوة الحاسوب السابقة ضمن المجموعة نفسها التي أنشأها النموذج. راجع نتيجة الأداة السابقة؛ وعند الحاجة تحقق من الحالة الحالية باستخدام computer_observe ثم أعد اقتراح هذا الإجراء في الجولة التالية.",
  approvedCompleted: "اكتمل الإجراء {tool} الموافق عليه (exitCode={exitCode}).",
  approvedFailed: "فشل الإجراء {tool} الموافق عليه (exitCode={exitCode}).",
  approvedUnknown:
    "تعذر التحقق من نتيجة الإجراء الموافق عليه؛ تم حظر التكرار التلقائي. تلزم مراجعة المشغل.",
  unknownFinalization: "خطأ غير معروف أثناء حفظ النتيجة",
  invocationExpired: "محظور: انتهت مدة صلاحية تنفيذ استدعاء العملية.",
  runtimeUnavailable:
    "محظور: لم تعد بيئة التشغيل تملك صلاحية تنفيذ هذه العملية.",
  agentAuthorityLost: "محظور: انتهت صلاحية تنفيذ الوكيل أو تغيّرت.",
  taskAuthorityLost: "محظور: انتهت صلاحية تنفيذ المهمة أو تغيّرت.",
  operationStateInvalid: "تعذّر التحقق من حالة العملية. يلزم فحص المشغّل.",
  commandNotStarted: "(لم يبدأ تنفيذ الأمر)",
  scopeActivated:
    "حماية النطاق مفعّلة. الأدوات المسموح بها في دور المحادثة هذا: {tools}.",
  taskUnknownStopped:
    "نتيجة العملية غير مؤكدة؛ أُوقفت المهمة واستدعاءات الأدوات اللاحقة. حُظرت إعادة التنفيذ التلقائية.",
  taskDeferred:
    "تُنفّذ العملية بواسطة عامل آخر؛ أُضيفت المهمة إلى قائمة الانتظار لإعادة المحاولة بأمان.",
} satisfies TerminalCopy;
