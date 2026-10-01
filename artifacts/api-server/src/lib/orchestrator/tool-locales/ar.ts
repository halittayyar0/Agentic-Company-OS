import type { ToolCopy } from "../tool-copy";

export const toolAr: ToolCopy = {
  schedulerClaimed: "تم تولي المهمة",
  projectMeetingRunning: "جارٍ إعداد رد لاجتماع المشروع: {title}",
  schedulerAccepted: "تم قبول المهمة وبدأ العمل.",
  schedulerRecovered: "تمت استعادة العمل المنقطع وإعادته إلى قائمة الانتظار.",
  schedulerRecoveryPaused:
    "تمت استعادة العمل المنقطع؛ ولا يزال التنفيذ معلقًا بسبب الإيقاف الطارئ.",
  schedulerRecoveryPausedNote:
    "تم تحرير ملكية تنفيذ العمل المنقطع؛ ويظل التنفيذ معلقًا حتى رفع الإيقاف الطارئ.",
  schedulerRecoveryNote:
    "تم تحرير ملكية تنفيذ العمل المنقطع وإعادة المهمة إلى قائمة الانتظار.",
  schedulerStepBudget: "تم بلوغ حد الخطوات الذي حدده المشغّل ({used}/{limit}).",
  schedulerTokenBudget: "تم بلوغ ميزانية الرموز ({used}/{limit}).",
  schedulerCostBudget:
    "تم بلوغ ميزانية التكلفة التي أبلغ عنها المزوّد (${used}/{limit}).",
  schedulerFamilyTokenBudget:
    "تم بلوغ ميزانية الرموز المشتركة للمهمة #{rootTaskId} ومهامها الفرعية ({used}/{limit}).",
  schedulerFamilyCostBudget:
    "تم بلوغ ميزانية التكلفة المشتركة التي أبلغ عنها المزوّد للمهمة #{rootTaskId} ومهامها الفرعية (${used}/{limit}).",
  schedulerFamilyDailyTokenBudget:
    "تم بلوغ ميزانية الرموز المشتركة خلال آخر 24 ساعة للمهمة #{rootTaskId} ومهامها الفرعية ({used}/{limit}).",
  schedulerFamilyDailyCostBudget:
    "تم بلوغ ميزانية التكلفة المشتركة التي أبلغ عنها المزوّد خلال آخر 24 ساعة للمهمة #{rootTaskId} ومهامها الفرعية (${used}/{limit}).",
  schedulerBudgetStopped: "توقفت المهمة بسبب حد ميزانية الأمان: {reason}",
  pathInvalid: "خطأ: يجب أن تكون path نصًا.",
  pathNoncanonical:
    "خطأ: لا يجوز أن يبدأ path أو ينتهي بمحارف بيضاء؛ لا تُغيَّر أسماء الملفات بصمت.",
  teamToolNameInvalid:
    "خطأ: يجب أن يطابق toolName معرّف الأداة تمامًا دون محارف بيضاء حوله.",
  directoryObserved: "يُعرض {shown} من أصل {count} إدخالات جرى رصدها.",
  directoryScanLimited: "بلغ فحص المجلد الحد المسموح؛ قد توجد إدخالات أخرى.",
  directoryEntriesSkipped: "عدد الإدخالات التي تعذّر فحصها: {count}.",
  pathRequired: "خطأ: يجب تحديد path غير فارغ.",
  contentRequired:
    "خطأ: يجب أن تكون content نصًا؛ لإنشاء ملف فارغ أرسل نصًا فارغًا صراحةً.",
  listDispatch: "جارٍ قراءة قائمة الملفات",
  readDispatch: "جارٍ قراءة الملف",
  writeDispatch: "جارٍ كتابة الملف",
  directoryEmpty: "المجلد فارغ: /{path}",
  directoryFile: "[FILE] {path} ({bytes} بايت)",
  directoryTotal: "(إجمالي العناصر: {count})",
  directoryListed: "عرض {name} محتويات المجلد: /{path}",
  directoryEmptyListed: "عرض {name} مجلدًا فارغًا: /{path}",
  directoryListFailed: "واجه {name} خطأ أثناء عرض محتويات المجلد.",
  fileRead: "قرأ {name} الملف: {path}",
  fileWritten: "كتب {name} ملفًا في مساحة العمل: {path} ({bytes} بايت).",
  fileWriteComplete: "كُتب الملف: {path} ({bytes} بايت).",
  fileReadFailed: "واجه {name} خطأ أثناء قراءة الملف.",
  fileWriteFailed: "واجه {name} خطأ أثناء كتابة الملف.",
  listFailure: "تعذرت قراءة قائمة الملفات.",
  readFailure: "تعذرت قراءة الملف.",
  writeFailure: "تعذرت كتابة الملف.",
  fileTruncated: "...(اقتُطع المحتوى)",
  computerPermissionDenied: "خطأ: لا يملك هذا الوكيل صلاحية مراقبة الحاسوب.",
  computerDispatch: "جارٍ قراءة حالة الحاسوب",
  computerTitle: "حالة الحاسوب",
  workspaceTitle: "الطرفية / مساحة العمل",
  browserTitle: "المتصفح",
  computerRecent: "خطوات الحاسوب الأخيرة (من الأقدم إلى الأحدث)",
  computerNext:
    "اختر إجراءً واحدًا تاليًا على الحاسوب بناءً على هذه الحالة الفعلية؛ افحص نتيجته قبل المتابعة.",
  computerObserved: "راقب {name} حالة الحاسوب.",
  computerObservationFailed: "واجه {name} خطأ أثناء مراقبة حالة الحاسوب.",
  computerFailure: "فشلت مراقبة الحاسوب.",
  computerError: "خطأ في المراقبة: {message}",
  emergencyBlocked:
    "محظور: فُعّل الإيقاف الطارئ أو تغير أثناء التنفيذ؛ أُوقفت عملية الأداة.",
  operationFailure: "تعذر إكمال عملية الأداة.",
  browserPermissionDenied:
    "خطأ: لا يملك هذا الوكيل صلاحية استخدام المتصفح (canBrowse).",
  browserWorkerOnly:
    "محظور: لا يمكن لعملية API المنفصلة تشغيل أدوات المتصفح محليًا؛ يجب أن تنفذ عملية العامل هذه العملية.",
  browserUrlRequired: "خطأ: يجب أن تكون url نصًا غير فارغ.",
  browserUrlInvalid: "خطأ: url غير صالح.",
  browserRefRequired:
    "خطأ: يجب أن تكون ref عددًا صحيحًا موجبًا ضمن النطاق الآمن.",
  browserInputTextInvalid:
    "يجب ألا يكون نص المتصفح فارغًا، وأن يكون Unicode صالحًا دون NUL؛ الحد هو 4096 وحدة ترميز UTF-16.",
  browserTextRequired: "خطأ: يجب أن تكون text نصًا.",
  browserSubmitInvalid: "خطأ: لا تقبل submit إلا true أو false.",
  browserDirectionRequired: "خطأ: لا تقبل direction إلا up أو down.",
  browserWaitRequired: "خطأ: يجب أن تكون milliseconds عددًا منتهيًا.",
  browserNameInvalid: "خطأ: يجب أن تكون name نصًا.",
  browserSeparateSubmit:
    "محظور: يجب أن يكون إدخال النص وإرسال النموذج إجراءين منفصلين، لكل منهما موافقته. استخدم أولًا browser_type مع submit=false؛ ثم احصل على snapshot جديد واطلب موافقة منفصلة على النقر على زر الإرسال المحدد باستخدام browser_click.",
  browserTargetChanged:
    "محظور: تغير هدف المتصفح المعتمد أو لم يعد متاحًا؛ يلزم snapshot جديد وموافقة جديدة.",
  browserFieldChanged:
    "محظور: تغير حقل المتصفح المعتمد أو أصبح مخصصًا لبيانات حساسة أو لم يعد متاحًا؛ يلزم snapshot جديد وموافقة جديدة.",
  browserSensitiveBlocked:
    "محظور: لا يمكن للوكيل ملء حقول كلمات المرور أو OTP أو البطاقات أو بيانات التعريف الحساسة المشابهة. يجب أن يملأ المؤسس هذا الحقل بنفسه عبر Browser Workbench.",
  browserUnknown: "خطأ غير معروف",
  browserOpenDispatch: "جارٍ فتح صفحة المتصفح",
  browserSnapshotDispatch: "جارٍ مراقبة صفحة المتصفح",
  browserApprovedClickDispatch: "جارٍ إرسال النقرة المعتمدة",
  browserClickDispatch: "جارٍ إرسال نقرة إلى المتصفح",
  browserLinkDispatch: "جارٍ فتح الرابط الآمن",
  browserApprovedTypeDispatch: "جارٍ إرسال النص المعتمد",
  browserTypeDispatch: "جارٍ إرسال النص إلى المتصفح",
  browserScrollDispatch: "جارٍ تمرير المتصفح",
  browserExtractDispatch: "جارٍ قراءة نص المتصفح",
  browserWaitDispatch: "جارٍ الانتظار في المتصفح",
  browserScreenshotDispatch: "جارٍ حفظ دليل من المتصفح",
  browserOpened: "فتح {name} صفحة في المتصفح.",
  browserOpenFailed: "تعذر على {name} فتح صفحة المتصفح.",
  browserObserved: "راقب {name} صفحة المتصفح.",
  browserObserveFailed: "واجه {name} خطأ أثناء مراقبة المتصفح.",
  browserApprovedClicked: "نقر {name} على الهدف المعتمد في الصفحة.",
  browserClicked: "تم النقر.",
  browserClickFailed: "واجه {name} خطأ أثناء النقر في المتصفح.",
  browserClickApproval: "ينتظر {name} الموافقة على النقر في المتصفح.",
  browserLinkOpened: "فتح {name} وجهة الرابط الآمن.",
  browserLinkFailed: "واجه {name} خطأ أثناء فتح الرابط الآمن.",
  browserLinkFailure: "تعذر فتح الرابط الآمن.",
  browserApprovedTyped: "أدخل {name} النص في حقل المتصفح المعتمد.",
  browserTyped: "أُدخل النص. تظهر حالة الصفحة الحالية أدناه.",
  browserSensitiveAvoided:
    "توقف {name} بأمان عن التفاعل مع حقل المتصفح الحساس.",
  browserTypeApproval: "ينتظر {name} الموافقة على إدخال النص في المتصفح.",
  browserTypeFailed: "واجه {name} خطأ أثناء إدخال النص في المتصفح.",
  browserScrolledDown: "مرّر {name} صفحة المتصفح إلى الأسفل.",
  browserScrolledUp: "مرّر {name} صفحة المتصفح إلى الأعلى.",
  browserDown: "تم التمرير إلى الأسفل.",
  browserUp: "تم التمرير إلى الأعلى.",
  browserScrollFailed: "واجه {name} خطأ أثناء تمرير المتصفح.",
  browserExtracted: "استخرج {name} النص الظاهر في المتصفح.",
  browserExtractFailed: "واجه {name} خطأ أثناء استخراج نص المتصفح.",
  browserEmptyText: "(نص الصفحة فارغ)",
  browserWaited: "راقب {name} صفحة المتصفح الديناميكية مجددًا.",
  browserWaitComplete: "اكتمل الانتظار لمدة {milliseconds} مللي ثانية.",
  browserWaitFailed: "واجه {name} خطأ أثناء خطوة الانتظار في المتصفح.",
  browserScreenshotSaved: "حفظ {name} لقطة شاشة المتصفح كدليل.",
  browserScreenshotFailed: "تعذر على {name} حفظ لقطة المتصفح كدليل.",
  browserPngSaved: "حُفظ الدليل بصيغة PNG: {path}",
  browserSize: "الحجم: {bytes} بايت",
  browserError: "خطأ في المتصفح: {message}",
  browserSnapshotError: "خطأ في مراقبة الصفحة: {message}",
  browserClickError: "خطأ في النقر: {message}",
  browserTypeError: "خطأ في إدخال النص: {message}",
  browserScrollError: "خطأ في التمرير: {message}",
  browserExtractError: "خطأ في استخراج النص: {message}",
  browserWaitError: "خطأ في الانتظار: {message}",
  browserScreenshotError: "خطأ في لقطة الشاشة: {message}",
  browserPage: "الصفحة: {title} · {url}",
  browserUntitled: "(بلا عنوان)",
  browserReferences: "مراجع العناصر التفاعلية:",
  browserValue: "{text} (القيمة: {value})",
  browserVisibleText: "النص الظاهر (الجزء الأول):",
  browserActionUnknown:
    "أُرسل إجراء المتصفح لكن تعذر تأكيد نتيجته. حُظرت إعادة المحاولة تلقائيًا.",
  browserLaunchFailed: "تعذر تشغيل المتصفح ({channel}): {message}",
  browserLaunchUnavailable: "تعذر تشغيل المتصفح ({channel}).",
  browserDisconnected:
    "انقطع اتصال جلسة المتصفح أثناء تنفيذ الإجراء؛ لن يُكرر الإجراء تلقائيًا في جلسة جديدة.",
  browserSessionLimit:
    "تم بلوغ الحد الأقصى لجلسات المتصفح ({limit}). تُغلق الجلسات غير النشطة تلقائيًا.",
  browserSessionMissing: "جلسة المتصفح غير متاحة.",
  browserAffinityFailure:
    "تعذر ربط جلسة المتصفح ببيئة التنفيذ بأمان؛ أُغلقت الجلسة.",
  browserSessionChanged: "أُغلقت جلسة المتصفح أو تغيرت؛ لم يُنفذ الأمر.",
  browserApprovedSessionChanged:
    "أُغلقت جلسة المتصفح المعتمدة أو تغيرت؛ تلزم موافقة جديدة.",
  browserRefMissing: "لم يُعثر على ref={ref}. استخدم browser_snapshot أولًا.",
  browserRefDetached: "لم يعد ref={ref} ظاهرًا في الصفحة.",
  browserRefStale: "ينتمي ref={ref} إلى snapshot قديم. احصل على snapshot جديد.",
  browserApprovedElementChanged:
    "تغيرت الصفحة أو العنصر المستهدف بعد الموافقة؛ تلزم موافقة جديدة.",
  browserApprovedFieldChanged:
    "تغيرت الصفحة أو الحقل المستهدف بعد الموافقة؛ تلزم موافقة جديدة.",
  browserOperatorLeaseRequired: "يلزم leaseId نشط لإجراء المشغّل.",
  browserClosing: "جارٍ إغلاق جلسة المتصفح؛ لا يمكن بدء إجراء جديد.",
  browserRuntimeClosing:
    "يجري بالفعل إغلاق بيئة تشغيل المتصفح أو إيقافها مؤقتًا.",
  browserQueueFull:
    "طابور إدخال المتصفح ممتلئ ({limit})؛ يجب أن يقلل العميل معدل الإرسال.",
  browserOperatorOwns:
    "تولى المشغّل التحكم في هذا المتصفح؛ إجراءات الوكيل غير متاحة حتى {expiresAt}.",
  browserAgentBusy:
    "ينفذ الوكيل إجراءً في المتصفح؛ انتظر انتهاء الإجراء ثم أعد المحاولة لتولي التحكم.",
  browserOtherOperator: "المتصفح تحت صلاحية تنفيذ مشغّل آخر.",
  browserLeaseInvalid: "صلاحية التحكم في المتصفح غير صالحة أو منتهية.",
  browserReleaseOwnerOnly:
    "لا يمكن إعادة المتصفح إلى الوكيل إلا لصاحب صلاحية التحكم النشطة.",
  browserOperatorBusy:
    "ينفذ المشغّل إجراءً في المتصفح؛ لا يمكن التخلي عن التحكم بعد.",
  browserActionInFlight:
    "لا يمكن إغلاق الجلسة أثناء تنفيذ إجراء في المتصفح؛ انتظر انتهاء الإجراء.",
  browserCloseOwnerOnly:
    "لا يمكن إغلاق المتصفح الخاضع لتحكم المشغّل إلا باستخدام leaseId كامل ونشط.",
  browserTargetInvalid: "هدف المتصفح غير صالح.",
  browserPrivateTarget:
    "حظرت سياسة أمان المتصفح الأهداف الموجودة في الشبكات الخاصة أو المحلية.",
  browserPrivateIp: "حُظرت عناوين IP الخاصة أو المحلية.",
  browserUnsafeResolution:
    "تعذر التحقق من عنوان IP آمن ومتاح لاسم النطاق المستهدف.",
  browserUnresolved: "تعذر حل اسم النطاق المستهدف.",
  browserProtocolDenied: "يُسمح بعناوين http وhttps فقط.",
  browserCredentialsDenied:
    "لا يُسمح باستخدام اسم مستخدم أو كلمة مرور داخل URL.",
  teamStringRequired: "خطأ: يجب أن تكون {field} نصًا غير فارغ.",
  teamStringInvalid: "خطأ: يجب أن تكون {field} نصًا.",
  teamNumberInvalid: "خطأ: يجب أن تكون {field} عددًا صالحًا.",
  teamChoiceInvalid: "خطأ: يجب أن تكون {field} إحدى القيم التالية: {choices}.",
  teamBriefTooLong: "خطأ: يجب ألا تتجاوز brief عدد 8000 حرف.",
  teamCadenceInvalid:
    "خطأ: يجب أن تكون autonomyMode بقيمة finite/continuous؛ ولا تُقبل cadenceSeconds إلا مع continuous وفي النطاق 60-604800.",
  teamCreateDenied: "خطأ: لا يملك هذا الوكيل صلاحية إنشاء وكلاء فرعيين.",
  teamDelegateDenied: "خطأ: لا يملك هذا الوكيل صلاحية تفويض المهام.",
  teamAgentCapacity:
    "محظور: تم بلوغ الحد الأقصى للوكلاء النشطين (limit={limit}).",
  teamTaskCapacity:
    "محظور: تم بلوغ الحد الأقصى للمهام المعلقة (limit={limit}).",
  teamCreateStopped: "محظور: أُوقفت المهمة؛ لم يُنشأ وكيل فرعي.",
  teamAgentCreated: "أُنشئ وكيل فرعي جديد. agentId={id}",
  teamAgentActivity:
    "أنشأ {name} وكيلًا فرعيًا جديدًا باسم «{child}» ({role}).",
  teamDelegateStopped:
    "محظور: الوكيل المستهدف غير نشط أو غير مؤهل، أو أُوقفت المهمة المصدر؛ لم يُنشأ تفويض.",
  teamDelegated: "أُنشئت المهمة وفُوضت. taskId={id}",
  teamTaskCreatedActivity: "أُنشئت مهمة جديدة: «{title}»",
  teamDelegatedActivity:
    "فوّض {name} المهمة «{title}» إلى الوكيل {target} ({role}).",
  teamTaskContext: "خطأ: لا يوجد سياق مهمة نشطة.",
  teamProgressDefault: "حُدّث التقدم.",
  teamProgressStopped: "محظور: أُوقفت المهمة؛ لم يُحفظ التقدم.",
  teamProgressSaved: "حُفظ التقدم: {progress}%.",
  teamTaskLost: "محظور: أُوقفت المهمة أو فُقدت صلاحية تنفيذها.",
  teamChildUnresolved:
    "محظور: لا تزال المهمة الفرعية المرتبطة taskId={id} في حالة {status}؛ احسم نتيجتها أو ألغها أولًا.",
  teamCompletionRejected:
    "رفضت المراجعة هذا الإكمال: {reason} اجعل المهمة متوافقة مع التعليمات الأصلية ثم أعد المحاولة.",
  teamCyclePrepared: "جُهزت دورة العمل هذه للإنهاء الذري في {at}.",
  teamCompletionPrepared: "جُهز إكمال المهمة للتثبيت الذري.",
  teamCycleActivity:
    "اكتملت دورة العمل المستمر هذه؛ وجُدول التشغيل التالي: {summary}",
  teamCompletionWarnActivity: "اكتملت المهمة (مع تحذير من المراجعة): {summary}",
  teamCompletionActivity: "اكتملت المهمة: {summary}",
  teamChildCompletedActivity:
    "أكمل {name} المهمة الفرعية المرتبطة: «{title}» -- {summary}",
  teamCompletionStopped: "محظور: أُوقفت المهمة؛ لم يُحفظ الإكمال.",
  teamCycleComplete: "اكتملت دورة العمل هذه؛ ستُشغل المهمة مجددًا في {at}.",
  teamComplete: "وُسمت المهمة بأنها مكتملة بنجاح.",
  teamApprovalUnsupported:
    "محظور: لا يمكن تنفيذ {tool} ذريًا بعد الموافقة؛ يجب أن تتضمن الموافقة التي تحمل اسم أداة إجراءً قابلًا للتنفيذ.",
  teamApprovalScopeRequired:
    "محظور: تتطلب الموافقة المحددة بأداة وجود toolName و toolArgs معًا.",
  teamApprovalArgsInvalid: "خطأ: يجب أن تكون toolArgs كائن JSON.",
  teamSudoDenied:
    "محظور: لا يمكن إنشاء موافقة sudo إلا بواسطة وكيل CEO الجذري النشط والمخوّل، مع تفعيل إذن التنفيذ.",
  teamSudoInvalid: "محظور: موافقة sudo غير صالحة ({reason})",
  teamSudoTitle: "حرج: أمر CEO Host Shell",
  teamSudoDescription:
    "تسمح هذه الموافقة بتشغيل الأمر المحدد حرفيًا مرة واحدة على المضيف وفي مجلد البدء المحددين، بصلاحيات نظام التشغيل الحالية لحساب خدمة API؛ ولا تمنح ترقية إلى صلاحيات root/Administrator. قد تتغير البرامج أو النصوص البرمجية التي يستدعيها الأمر بعد الموافقة؛ وقد تستمر العمليات الفرعية بعد انتهاء مهلة الصدفة.",
  teamCategoryRequired:
    "محظور: يتطلب {tool} الفئة category={category}؛ ولا يمكن لفئة أدنى أن تمنح الإذن بهذا الإجراء.",
  teamCategoryDenied:
    "محظور: لا يملك هذا الوكيل صلاحية اقتراح إجراءات في الفئة {category}.",
  teamBrowserApprovalContext:
    "محظور: تتطلب موافقة المتصفح وجود عامل تنفيذ نشط و snapshot حالي و ref رقمي.",
  teamBrowserApprovalMissing:
    "محظور: لم يُعثر على هدف المتصفح في الجلسة الحالية؛ احصل على snapshot جديد واقترح الإجراء مجددًا.",
  teamBrowserApprovalSensitive:
    "محظور: لا يمكن ملء حقول المتصفح الحساسة عبر الموافقة على إجراءات الوكيل.",
  teamSpendAmount: "محظور: تتطلب موافقة الإنفاق قيمة amountUsd موجبة ومنتهية.",
  teamApprovalStopped: "محظور: أُوقفت المهمة؛ لم يُنشأ طلب موافقة.",
  teamAmount: "المبلغ: ${amount}",
  teamApprovalRejected:
    "رفضت المراجعة طلب الموافقة هذا: {reason} لا تبدأ هذا الإجراء.",
  teamSudoRevoked: "محظور: سُحبت صلاحية sudo قبل إنشاء سجل الموافقة.",
  teamSudoTargetChanged:
    "محظور: تغير مضيف sudo أو مساحة العمل قبل إنشاء الموافقة.",
  teamApprovalPrepared: "جُهز طلب الموافقة للتثبيت الذري.",
  teamApprovalActivity: "طلب موافقة: {title}",
  teamApprovalCapacity:
    "محظور: تم بلوغ الحد الأقصى للموافقات/المهام (limit={limit}).",
  teamApprovalCreated:
    "أُنشئ طلب الموافقة (approvalId={id}, taskId={taskId})؛ بانتظار موافقة المستخدم.",
  teamApprovalExpiry: " الموافقة صالحة لمدة {minutes} دقيقة ولاستخدام واحد.",
  teamReviewNote: " (ملاحظة المراجعة: {reason})",
  teamQuestionBound:
    "خطأ: يجب أن تحتوي question على نص ظاهر وألا تتجاوز 1000 حرف. اطرح سؤالًا واحدًا كاملًا وموجزًا.",
  teamQuestionPrepared: "جُهز السؤال للتثبيت الذري.",
  teamInputWaiting: "بانتظار إدخال المستخدم.",
  teamQuestionActivity: "سؤال: {question}",
  teamQuestionStopped: "محظور: أُوقفت المهمة؛ لم يُحفظ السؤال.",
  teamQuestionSaved: "حُفظ السؤال؛ بانتظار إجابة المستخدم.",
  teamNoteSaved: "حُفظت الملاحظة.",
  teamMessageBound: "خطأ: يجب ألا تتجاوز رسالة القناة المشتركة 4000 حرف.",
  teamChannelName: "دردشة الشركة المشتركة",
  teamChannelMissing: "لم يُعثر على قناة الشركة.",
  teamMembershipMissing: "الوكيل ليس عضوًا في غرفة الشركة أو غير نشط.",
  teamReplyMissing: "لم يُعثر على رسالة القناة المشتركة التي يجري الرد عليها.",
  teamMessageCooldown:
    "يجب أن تفصل 5 ثوانٍ على الأقل بين رسائل الوكيل نفسه في القناة المشتركة.",
  teamMessageCapacity:
    "محظور: تم بلوغ الحد الأقصى لرسائل القناة المشتركة (limit={limit}).",
  teamBlocked: "محظور: {reason}",
  teamMessageFailed: "محظور: تعذر حفظ رسالة القناة المشتركة.",
  teamMessageSaved:
    "حُفظت رسالة قناة الشركة المشتركة بهويتك الفعلية بوصفك المرسل (messageId={id}).",
  previewInstance: "مثيل عملية API: {id}",
  previewHost: "المضيف: {host}",
  previewDirectory: "مجلد البدء: {path}",
  previewCommand: "الأمر المحدد (سيُنفذ حرفيًا):",
  previewWarning:
    "تحذير: قد تتغير البرامج أو النصوص البرمجية التي يستدعيها الأمر بعد الموافقة؛ وقد تستمر العمليات الفرعية بعد انتهاء مهلة الصدفة.",
  previewPage: "الصفحة: {url}",
  previewUnknown: "(غير معروف)",
  previewField: "الحقل: {role} · {text}",
  previewFieldDefault: "حقل",
  previewUnlabeled: "(بلا تسمية)",
  previewContext: "السياق: {text}",
  previewText: "النص المراد إدخاله: {text}",
  previewSubmit: "الإرسال باستخدام Enter: {value}",
  previewYes: "نعم",
  previewNo: "لا",
  previewElement: "العنصر: {role} · {text}",
  previewElementDefault: "عنصر",
  previewLink: "الرابط: {url}",
  previewForm: "وجهة النموذج: {url}",
  judgeMissingReason: "لم تُرجع المراجعة مبررًا.",
  judgeSudoReason:
    "صُنّف اقتراح sudo بأنه {verdict}؛ ولا يُعرض الأمر المحدد إلا ضمن الموافقة البشرية المحلية.",
  judgeReview: "المراجعة ({purpose}): {verdict}",
  judgeCompletion: "الإكمال",
  judgeApproval: "طلب الموافقة",
  judgeRedacted: "[محجوب: يُحتفظ بأمر sudo المحدد فقط في الموافقة المعلقة]",
  judgeCompletionUnavailable: "أُوقف الإكمال بأمان لتعذر التحقق من المراجعة.",
  judgeApprovalUnavailable:
    "خدمة المراجعة غير متاحة؛ لا يمكن متابعة هذا الطلب إلا بموافقة بشرية.",
  judgeUnavailable: "المراجعة غير متاحة: {verdict}",
  teamAgentReplayed:
    "أُنشئ الوكيل الفرعي سابقًا؛ لم يُنشأ مجددًا. agentId={id}",
  teamTaskReplayed: "حُفظ التفويض سابقًا؛ لم يُنشأ مجددًا. taskId={id}",
  teamApprovalReplayed:
    "حُفظ طلب الموافقة ذريًا سابقًا؛ لم يُنشأ مجددًا. approvalId={id}",
  teamOperationReplayed:
    "حُفظت العملية ذريًا سابقًا؛ لم تُطبق مجددًا.{evidence}",
  teamEvidence: " الدليل: {data}.",
  readReplayed:
    "اكتملت القراءة سابقًا؛ لم يُحفظ المحتوى الأصلي في سجل العملية. اطلب قراءة جديدة للحصول على البيانات الحالية.",
  readReconciled:
    "راجع المشغّل هذه القراءة وأكّد تنفيذها؛ لم تُكرّر تلقائيًا ولم يُحفظ المحتوى الأصلي.",
  readRetry: "تعذّر إكمال القراءة؛ أُتيح إجراء محاولة آمنة أخرى.",
  teamCreateDispatch: "جارٍ إنشاء وكيل فرعي",
  teamDelegateDispatch: "جارٍ تفويض المهمة",
  teamProgressDispatch: "جارٍ حفظ التقدم",
  teamCompleteDispatch: "جارٍ مراجعة نتيجة المهمة",
  teamApprovalDispatch: "جارٍ طلب موافقة المشغّل",
  teamQuestionDispatch: "جارٍ طلب معلومات من المستخدم",
  teamNoteDispatch: "جارٍ حفظ ملاحظة الأدلة",
  teamMessageDispatch: "جارٍ إرسال رسالة إلى القناة المشتركة",
  toolDispatch: "جارٍ تشغيل الأداة · {tool}",
  chatAnalyzing: "جارٍ تحليل الرسالة",
  chatPlanning: "جارٍ إعداد الرد · الجولة {round}/{total}",
  taskAnalyzing: "جارٍ تحليل المهمة",
  taskPlanning: "جارٍ التخطيط · الجولة {round}/{total}",
  taskModelRunning: "جارٍ تشغيل النموذج · {model}",
  taskOwnerMissing:
    "الوكيل المسؤول عن المهمة غير موجود أو غير نشط؛ تم وضع علامة فشل على المهمة.",
  taskLeaseMismatch: "لا تتطابق ملكية تصريح التنفيذ للمهمة والوكيل.",
  modelFallback:
    "تعذّر على النموذج الأساسي إحراز تقدم في هذه الخطوة؛ تستمر المهمة باستخدام النموذج البديل المسموح به {model}.",
  modelRouteFailed:
    "النموذج غير متاح؛ تحاول المهمة استخدام النموذج المسموح به التالي {model}.",
  taskUnknownError: "خطأ غير معروف في خطوة المهمة.",
  taskBlocked:
    "توقفت المهمة بعد {count} أخطاء تشغيل متتالية؛ تلزم مراجعة المشغّل.",
  taskProviderRetry:
    "فشلت المحاولات مع جميع النماذج المسموح بها؛ حُفظت المهمة وأُعيدت جدولتها للوقت {at}.",
  taskRuntimeRetry:
    "حدث خطأ تشغيل في هذه الخطوة؛ أُعيدت جدولة المهمة للوقت {at}.",
  receiptLabel: "سجل العملية: {id}",
  toolUnknown: "خطأ: الأداة '{tool}' غير معروفة.",
  approvedToolCompleted: "اكتمل الإجراء الموافق عليه: {tool}.",
  approvedToolFailed: "فشل الإجراء الموافق عليه: {tool}.",
  exclusiveTurnInstruction:
    "قيّد المستخدم هذه الجولة صراحةً بالأدوات التالية: {tools}. لا تتجاوز هذا النطاق حتى إن بدا ذلك مفيدًا لتحقيق النتيجة المسموح بها؛ ولا تنشئ ملاحظات أو ملفات أو مهام أو وكلاء فرعيين خارج هذا النطاق. إذا لم تكفِ الأدوات المسموح بها، فأبلغ بذلك دون توسيع النطاق.",
  exclusiveSudoExactInstruction:
    "لا يجوز طلب الموافقة على sudo إلا للأمر المطابق تمامًا لما قدّمه المستخدم.",
  exclusiveSudoUnavailableInstruction:
    "تعذّر تحديد أمر sudo الدقيق بأمان. لا تستخدم أداة sudo في هذه الجولة؛ وأبلغ بالعائق دون توسيع النطاق.",
  operationReconciled: "طابق المشغّل نتيجة العملية غير المؤكدة.",
  approvalBindingInvalidated:
    "لم يعد ارتباط المتصفح الموافق عليه صالحًا؛ تلزم موافقة جديدة.",
  judgeRunning: "جارٍ مراجعة المهمة",
  taskAdvanceInstruction:
    "قدّم المهمة خطوة واحدة. قيّم الحالة الحالية ونفّذ استدعاءات الأدوات المناسبة.",
  taskOpenInstruction:
    "ما زالت المهمة مفتوحة. لا تتوقف بعد الشرح: استدعِ الأداة الآمنة التالية لتنفيذ خطوة محددة، واستخدم request_user_input عند الحاجة إلى إدخال بشري، أو complete_task عندما تثبت الأدلة استيفاء معايير القبول.",
  taskPassiveFallbackInstruction:
    "توقف النموذج السابق مرتين دون استخدام أداة لدورة حياة المهمة. حافظ على السياق نفسه وتابع بخطوة محددة باستخدام أداة.",
  taskBatchFallbackInstruction:
    "تجاوز النموذج السابق الحد الآمن لاستدعاءات الأدوات دفعة واحدة ({count}/{limit}). حافظ على المهمة نفسها، والتزم بأقل من هذا الحد في كل جولة، وتابع بأكثر خطوة محددة أمانًا.",
  taskLifecycleFallbackInstruction:
    "استدعى النموذج السابق أداة لدورة حياة المهمة مرتين بمعاملات غير صالحة أو مرفوضة. حافظ على السياق نفسه، وتحقق من النتيجة، واستدعِ الأداة بمعاملات صالحة.",
  taskToolRetryInstruction:
    "رُفضت جميع استدعاءات الأدوات في هذه الجولة لكونها غير صالحة أو غير مصرح بها أو لم تُنفّذ. صحح مخطط الأداة والصلاحيات، ثم نفّذ استدعاءً آخر محددًا وصالحًا.",
  taskToolFallbackInstruction:
    "أخفق النموذج السابق مرتين في استخدام بروتوكول الأدوات. حافظ على السياق نفسه وتابع بخطوة محددة واحدة تطابق تمامًا مخطط أداة مسموح بها.",
  operationCompleted: "اكتملت العملية: {tool}.",
  modelFailure: "{reason} ({source})",
  failureRateLimit: "تم بلوغ حد طلبات النموذج.",
  failureTimeout: "انتهت مهلة طلب النموذج.",
  failureAuthentication: "رفض مزوّد النموذج المصادقة.",
  failurePayment: "يتطلب مزوّد النموذج دفعًا أو رصيدًا متاحًا.",
  failureModelUnavailable: "النموذج المطلوب غير متاح.",
  failureToolCompatibility:
    "لم يُنتج النموذج ردًا صالحًا باستخدام بروتوكول الأدوات المطلوب.",
  failureProviderUnavailable: "مزوّد النموذج غير متاح.",
};
