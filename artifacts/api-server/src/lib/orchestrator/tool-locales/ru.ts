import type { ToolCopy } from "../tool-copy";

export const toolRu: ToolCopy = {
  schedulerClaimed: "Задача принята в работу",
  projectMeetingRunning: "Подготовка ответа на встрече по проекту: {title}",
  schedulerAccepted: "Задача принята; работа начата.",
  schedulerRecovered:
    "Прерванная работа восстановлена и снова поставлена в очередь.",
  schedulerRecoveryPaused:
    "Прерванная работа восстановлена; выполнение остаётся приостановленным из-за аварийной остановки.",
  schedulerRecoveryPausedNote:
    "Право выполнения прерванной работы освобождено; выполнение приостановлено до отмены аварийной остановки.",
  schedulerRecoveryNote:
    "Право выполнения прерванной работы освобождено; задача снова поставлена в очередь.",
  schedulerStepBudget:
    "Достигнут установленный оператором лимит шагов ({used}/{limit}).",
  schedulerTokenBudget: "Достигнут бюджет токенов ({used}/{limit}).",
  schedulerCostBudget:
    "Достигнут бюджет расходов по данным провайдера (${used}/{limit}).",
  schedulerFamilyTokenBudget:
    "Достигнут общий бюджет токенов задачи #{rootTaskId} и её подзадач ({used}/{limit}).",
  schedulerFamilyCostBudget:
    "Достигнут общий бюджет расходов задачи #{rootTaskId} и её подзадач по данным провайдера (${used}/{limit}).",
  schedulerFamilyDailyTokenBudget:
    "Достигнут общий бюджет токенов задачи #{rootTaskId} и её подзадач за последние 24 часа ({used}/{limit}).",
  schedulerFamilyDailyCostBudget:
    "Достигнут общий бюджет расходов задачи #{rootTaskId} и её подзадач за последние 24 часа по данным провайдера (${used}/{limit}).",
  schedulerBudgetStopped:
    "Задача остановлена из-за ограничения бюджета: {reason}",
  pathInvalid: "Ошибка: path должен быть строкой.",
  pathNoncanonical:
    "Ошибка: path не может начинаться или заканчиваться пробельными символами; имена файлов не изменяются без уведомления.",
  teamToolNameInvalid:
    "Ошибка: toolName должен точно совпадать с идентификатором инструмента без пробельных символов по краям.",
  directoryObserved: "Показано {shown} из {count} обнаруженных записей.",
  directoryScanLimited:
    "Достигнут предел просмотра каталога; могут существовать другие записи.",
  directoryEntriesSkipped: "Не удалось проверить записей: {count}.",
  pathRequired: "Ошибка: требуется непустой path.",
  contentRequired:
    "Ошибка: content должен быть строкой; для пустого файла явно передайте пустую строку.",
  listDispatch: "Чтение списка файлов",
  readDispatch: "Чтение файла",
  writeDispatch: "Запись файла",
  directoryEmpty: "Каталог пуст: /{path}",
  directoryFile: "[FILE] {path} ({bytes} байт)",
  directoryTotal: "(всего записей: {count})",
  directoryListed: "{name}: получен список каталога /{path}",
  directoryEmptyListed: "{name}: получен список пустого каталога /{path}",
  directoryListFailed: "{name}: ошибка при получении списка каталога.",
  fileRead: "{name}: прочитан файл {path}",
  fileWritten: "{name}: в рабочей области записан файл {path} ({bytes} байт).",
  fileWriteComplete: "Файл записан: {path} ({bytes} байт).",
  fileReadFailed: "{name}: ошибка при чтении файла.",
  fileWriteFailed: "{name}: ошибка при записи файла.",
  listFailure: "Не удалось прочитать список файлов.",
  readFailure: "Не удалось прочитать файл.",
  writeFailure: "Не удалось записать файл.",
  fileTruncated: "...(сокращено)",
  computerPermissionDenied:
    "Ошибка: у этого агента нет разрешения на наблюдение за компьютером.",
  computerDispatch: "Чтение состояния компьютера",
  computerTitle: "СОСТОЯНИЕ КОМПЬЮТЕРА",
  workspaceTitle: "ТЕРМИНАЛ / РАБОЧАЯ ОБЛАСТЬ",
  browserTitle: "БРАУЗЕР",
  computerRecent: "ПОСЛЕДНИЕ ШАГИ НА КОМПЬЮТЕРЕ (от старых к новым)",
  computerNext:
    "Выберите одно следующее действие на основе фактического состояния компьютера; изучите результат, прежде чем продолжать.",
  computerObserved: "{name}: выполнено наблюдение за состоянием компьютера.",
  computerObservationFailed:
    "{name}: ошибка при наблюдении за состоянием компьютера.",
  computerFailure: "Не удалось выполнить наблюдение за компьютером.",
  computerError: "Ошибка наблюдения: {message}",
  emergencyBlocked:
    "ЗАБЛОКИРОВАНО: аварийная остановка была включена или изменена во время выполнения; операция инструмента остановлена.",
  operationFailure: "Не удалось завершить операцию инструмента.",
  browserPermissionDenied:
    "Ошибка: у этого агента нет разрешения на работу с браузером (canBrowse).",
  browserWorkerOnly:
    "ЗАБЛОКИРОВАНО: отдельный процесс API не может выполнять инструменты браузера локально; эту операцию должен выполнить рабочий процесс.",
  browserUrlRequired: "Ошибка: url должен быть непустой строкой.",
  browserUrlInvalid: "Ошибка: недопустимый url.",
  browserRefRequired:
    "Ошибка: ref должен быть положительным целым числом в безопасном диапазоне.",
  browserInputTextInvalid:
    "Текст для браузера не должен быть пустым и должен содержать корректный Unicode без NUL; ограничение — 4096 кодовых единиц UTF-16.",
  browserTextRequired: "Ошибка: text должен быть строкой.",
  browserSubmitInvalid: "Ошибка: submit может быть только true или false.",
  browserDirectionRequired: "Ошибка: direction может быть только up или down.",
  browserWaitRequired: "Ошибка: milliseconds должен быть конечным числом.",
  browserNameInvalid: "Ошибка: name должен быть строкой.",
  browserSeparateSubmit:
    "ЗАБЛОКИРОВАНО: ввод текста и отправка формы должны быть отдельными одобренными действиями. Сначала используйте browser_type с submit=false; затем получите новый snapshot и запросите отдельное одобрение browser_click для конкретной кнопки отправки.",
  browserTargetChanged:
    "ЗАБЛОКИРОВАНО: одобренная цель в браузере изменилась или недоступна; требуются новый snapshot и новое одобрение.",
  browserFieldChanged:
    "ЗАБЛОКИРОВАНО: одобренное поле в браузере изменилось, стало полем для конфиденциальных данных или недоступно; требуются новый snapshot и новое одобрение.",
  browserSensitiveBlocked:
    "ЗАБЛОКИРОВАНО: агент не может заполнять поля паролей, OTP, банковских карт и других подобных конфиденциальных данных. Основатель должен заполнить это поле самостоятельно через Browser Workbench.",
  browserUnknown: "Неизвестная ошибка",
  browserOpenDispatch: "Открытие страницы браузера",
  browserSnapshotDispatch: "Наблюдение за страницей браузера",
  browserApprovedClickDispatch: "Отправка одобренного нажатия",
  browserClickDispatch: "Отправка нажатия в браузер",
  browserLinkDispatch: "Открытие безопасной ссылки",
  browserApprovedTypeDispatch: "Отправка одобренного текста",
  browserTypeDispatch: "Отправка текста в браузер",
  browserScrollDispatch: "Прокрутка браузера",
  browserExtractDispatch: "Чтение текста в браузере",
  browserWaitDispatch: "Ожидание в браузере",
  browserScreenshotDispatch: "Сохранение подтверждения из браузера",
  browserOpened: "{name}: открыта страница в браузере.",
  browserOpenFailed: "{name}: не удалось открыть страницу браузера.",
  browserObserved: "{name}: выполнено наблюдение за страницей браузера.",
  browserObserveFailed: "{name}: ошибка при наблюдении за браузером.",
  browserApprovedClicked:
    "{name}: выполнено нажатие на одобренную цель на странице.",
  browserClicked: "Нажатие выполнено.",
  browserClickFailed: "{name}: ошибка при нажатии в браузере.",
  browserClickApproval: "{name}: ожидается одобрение нажатия в браузере.",
  browserLinkOpened: "{name}: открыта цель безопасной ссылки.",
  browserLinkFailed: "{name}: ошибка при открытии безопасной ссылки.",
  browserLinkFailure: "Не удалось открыть безопасную ссылку.",
  browserApprovedTyped: "{name}: текст введён в одобренное поле браузера.",
  browserTyped: "Текст введён. Ниже показано текущее состояние страницы.",
  browserSensitiveAvoided:
    "{name}: безопасно прекращено взаимодействие с полем браузера для конфиденциальных данных.",
  browserTypeApproval: "{name}: ожидается одобрение ввода текста в браузере.",
  browserTypeFailed: "{name}: ошибка при вводе текста в браузере.",
  browserScrolledDown: "{name}: страница браузера прокручена вниз.",
  browserScrolledUp: "{name}: страница браузера прокручена вверх.",
  browserDown: "Прокручено вниз.",
  browserUp: "Прокручено вверх.",
  browserScrollFailed: "{name}: ошибка при прокрутке браузера.",
  browserExtracted: "{name}: извлечён видимый текст из браузера.",
  browserExtractFailed: "{name}: ошибка при извлечении текста из браузера.",
  browserEmptyText: "(текст страницы пуст)",
  browserWaited:
    "{name}: повторно выполнено наблюдение за динамической страницей браузера.",
  browserWaitComplete: "Ожидание завершено: {milliseconds} мс.",
  browserWaitFailed: "{name}: ошибка на шаге ожидания в браузере.",
  browserScreenshotSaved:
    "{name}: снимок экрана браузера сохранён как подтверждение.",
  browserScreenshotFailed:
    "{name}: не удалось сохранить подтверждающий снимок браузера.",
  browserPngSaved: "PNG-подтверждение сохранено: {path}",
  browserSize: "Размер: {bytes} байт",
  browserError: "Ошибка браузера: {message}",
  browserSnapshotError: "Ошибка наблюдения за страницей: {message}",
  browserClickError: "Ошибка нажатия: {message}",
  browserTypeError: "Ошибка ввода текста: {message}",
  browserScrollError: "Ошибка прокрутки: {message}",
  browserExtractError: "Ошибка извлечения текста: {message}",
  browserWaitError: "Ошибка ожидания: {message}",
  browserScreenshotError: "Ошибка снимка экрана: {message}",
  browserPage: "СТРАНИЦА: {title} · {url}",
  browserUntitled: "(без заголовка)",
  browserReferences: "ССЫЛКИ НА ИНТЕРАКТИВНЫЕ ЭЛЕМЕНТЫ:",
  browserValue: "{text} (значение: {value})",
  browserVisibleText: "ВИДИМЫЙ ТЕКСТ (начало):",
  browserActionUnknown:
    "Действие браузера отправлено, но его результат не удалось подтвердить. Автоматический повтор заблокирован.",
  browserLaunchFailed: "Не удалось запустить браузер ({channel}): {message}",
  browserLaunchUnavailable: "Не удалось запустить браузер ({channel}).",
  browserDisconnected:
    "Сеанс браузера прервался во время выполнения действия; действие не будет автоматически повторено в новом сеансе.",
  browserSessionLimit:
    "Достигнут предел числа сеансов браузера ({limit}). Неактивные сеансы закрываются автоматически.",
  browserSessionMissing: "Сеанс браузера недоступен.",
  browserAffinityFailure:
    "Не удалось безопасно привязать сеанс браузера к среде выполнения; сеанс закрыт.",
  browserSessionChanged:
    "Сеанс браузера закрыт или изменился; команда не выполнена.",
  browserApprovedSessionChanged:
    "Одобренный сеанс браузера закрыт или изменился; требуется новое одобрение.",
  browserRefMissing: "ref={ref} не найден. Сначала выполните browser_snapshot.",
  browserRefDetached: "ref={ref} больше не виден на странице.",
  browserRefStale:
    "ref={ref} относится к устаревшему snapshot. Получите новый snapshot.",
  browserApprovedElementChanged:
    "Страница или целевой элемент изменились после одобрения; требуется новое одобрение.",
  browserApprovedFieldChanged:
    "Страница или целевое поле изменились после одобрения; требуется новое одобрение.",
  browserOperatorLeaseRequired:
    "Для действия оператора требуется активный leaseId.",
  browserClosing: "Сеанс браузера закрывается; новое действие начать нельзя.",
  browserRuntimeClosing:
    "Среда выполнения браузера уже закрывается или приостанавливается.",
  browserQueueFull:
    "Очередь ввода браузера заполнена ({limit}); клиент должен снизить темп отправки.",
  browserOperatorOwns:
    "Оператор перехватил управление этим браузером; действия агента недоступны до {expiresAt}.",
  browserAgentBusy:
    "Агент выполняет действие в браузере; для перехвата управления дождитесь его завершения и повторите попытку.",
  browserOtherOperator:
    "Право управления браузером принадлежит другому оператору.",
  browserLeaseInvalid:
    "Право управления браузером недействительно или истекло.",
  browserReleaseOwnerOnly:
    "Вернуть браузер агенту может только обладатель действующего права управления.",
  browserOperatorBusy:
    "Оператор выполняет действие в браузере; передать управление пока нельзя.",
  browserActionInFlight:
    "Нельзя закрыть сеанс во время выполнения действия браузера; дождитесь завершения действия.",
  browserCloseOwnerOnly:
    "Браузер под управлением оператора можно закрыть только с полным и активным leaseId.",
  browserTargetInvalid: "Недопустимая цель браузера.",
  browserPrivateTarget:
    "Цели в частных или локальных сетях заблокированы политикой безопасности браузера.",
  browserPrivateIp: "Частные или локальные IP-адреса заблокированы.",
  browserUnsafeResolution:
    "Не удалось подтвердить безопасный и доступный IP-адрес для целевого доменного имени.",
  browserUnresolved: "Не удалось разрешить целевое доменное имя.",
  browserProtocolDenied: "Разрешены только адреса http и https.",
  browserCredentialsDenied:
    "Нельзя использовать имя пользователя или пароль в URL.",
  teamStringRequired: "Ошибка: {field} должен быть непустой строкой.",
  teamStringInvalid: "Ошибка: {field} должен быть строкой.",
  teamNumberInvalid: "Ошибка: {field} должен быть допустимым числом.",
  teamChoiceInvalid:
    "Ошибка: {field} должен иметь одно из значений: {choices}.",
  teamBriefTooLong: "Ошибка: brief не может содержать более 8000 символов.",
  teamCadenceInvalid:
    "Ошибка: autonomyMode должен быть finite/continuous; cadenceSeconds допустим только для continuous и должен быть в диапазоне 60-604800.",
  teamCreateDenied:
    "Ошибка: у этого агента нет права создавать подчинённых агентов.",
  teamDelegateDenied: "Ошибка: у этого агента нет права делегировать задачи.",
  teamAgentCapacity:
    "ЗАБЛОКИРОВАНО: достигнут предел числа активных агентов (limit={limit}).",
  teamTaskCapacity:
    "ЗАБЛОКИРОВАНО: достигнут предел числа незавершённых задач (limit={limit}).",
  teamCreateStopped:
    "ЗАБЛОКИРОВАНО: задача остановлена; подчинённый агент не создан.",
  teamAgentCreated: "Создан новый подчинённый агент. agentId={id}",
  teamAgentActivity:
    "{name}: создан новый подчинённый агент «{child}» ({role}).",
  teamDelegateStopped:
    "ЗАБЛОКИРОВАНО: целевой агент неактивен или не соответствует условиям либо исходная задача остановлена; делегирование не создано.",
  teamDelegated: "Задача создана и делегирована. taskId={id}",
  teamTaskCreatedActivity: "Создана новая задача: «{title}»",
  teamDelegatedActivity:
    "{name}: задача «{title}» делегирована агенту {target} ({role}).",
  teamTaskContext: "Ошибка: нет контекста активной задачи.",
  teamProgressDefault: "Прогресс обновлён.",
  teamProgressStopped:
    "ЗАБЛОКИРОВАНО: задача остановлена; прогресс не сохранён.",
  teamProgressSaved: "Прогресс сохранён: {progress}%.",
  teamTaskLost:
    "ЗАБЛОКИРОВАНО: задача остановлена или право на её выполнение утрачено.",
  teamChildUnresolved:
    "ЗАБЛОКИРОВАНО: связанная подзадача taskId={id} всё ещё имеет статус {status}; сначала определите её результат или отмените её.",
  teamCompletionRejected:
    "Проверка отклонила это завершение: {reason} Приведите задачу в соответствие с исходным указанием, затем повторите попытку.",
  teamCyclePrepared:
    "Этот рабочий цикл подготовлен к атомарному завершению в {at}.",
  teamCompletionPrepared:
    "Завершение задачи подготовлено к атомарной фиксации.",
  teamCycleActivity:
    "Этот цикл непрерывной работы завершён; следующий запуск запланирован: {summary}",
  teamCompletionWarnActivity:
    "Задача завершена (с предупреждением проверки): {summary}",
  teamCompletionActivity: "Задача завершена: {summary}",
  teamChildCompletedActivity:
    "{name}: связанная подзадача завершена: «{title}» -- {summary}",
  teamCompletionStopped:
    "ЗАБЛОКИРОВАНО: задача остановлена; завершение не сохранено.",
  teamCycleComplete:
    "Этот рабочий цикл завершён; задача будет запущена снова в {at}.",
  teamComplete: "Задача отмечена как успешно завершённая.",
  teamApprovalUnsupported:
    "ЗАБЛОКИРОВАНО: {tool} нельзя выполнить атомарно после одобрения; одобрение с именем инструмента должно содержать исполняемое действие.",
  teamApprovalScopeRequired:
    "ЗАБЛОКИРОВАНО: одобрение для конкретного инструмента требует одновременно toolName и toolArgs.",
  teamApprovalArgsInvalid: "Ошибка: toolArgs должен быть объектом JSON.",
  teamSudoDenied:
    "ЗАБЛОКИРОВАНО: одобрение sudo может создать только активный корневой агент CEO с необходимыми правами и включённым разрешением на выполнение.",
  teamSudoInvalid: "ЗАБЛОКИРОВАНО: недопустимое одобрение sudo ({reason})",
  teamSudoTitle: "КРИТИЧЕСКИ ВАЖНО: команда CEO Host Shell",
  teamSudoDescription:
    "Это одобрение позволяет один раз выполнить точную команду на указанном хосте и в начальном каталоге с текущими правами учётной записи службы API в операционной системе; повышения прав до root/Administrator оно не даёт. Скрипты или программы, вызываемые командой, могут измениться после одобрения; дочерние процессы могут продолжать работу после истечения времени ожидания командной оболочки.",
  teamCategoryRequired:
    "ЗАБЛОКИРОВАНО: {tool} требует category={category}; более низкая категория не может разрешить это действие.",
  teamCategoryDenied:
    "ЗАБЛОКИРОВАНО: у этого агента нет права предлагать действия в категории {category}.",
  teamBrowserApprovalContext:
    "ЗАБЛОКИРОВАНО: одобрение действия в браузере требует активного рабочего процесса, текущего snapshot и числового ref.",
  teamBrowserApprovalMissing:
    "ЗАБЛОКИРОВАНО: цель браузера не найдена в текущем сеансе; получите новый snapshot и предложите действие снова.",
  teamBrowserApprovalSensitive:
    "ЗАБЛОКИРОВАНО: поля браузера для конфиденциальных данных нельзя заполнять через одобрение действий агента.",
  teamSpendAmount:
    "ЗАБЛОКИРОВАНО: одобрение расходов требует положительного конечного amountUsd.",
  teamApprovalStopped:
    "ЗАБЛОКИРОВАНО: задача остановлена; запрос на одобрение не создан.",
  teamAmount: "Сумма: ${amount}",
  teamApprovalRejected:
    "Проверка отклонила этот запрос на одобрение: {reason} Не начинайте это действие.",
  teamSudoRevoked:
    "ЗАБЛОКИРОВАНО: разрешение sudo отозвано до создания записи об одобрении.",
  teamSudoTargetChanged:
    "ЗАБЛОКИРОВАНО: хост sudo или рабочая область изменились до создания одобрения.",
  teamApprovalPrepared: "Запрос на одобрение подготовлен к атомарной фиксации.",
  teamApprovalActivity: "Запрос на одобрение: {title}",
  teamApprovalCapacity:
    "ЗАБЛОКИРОВАНО: достигнут предел числа одобрений/задач (limit={limit}).",
  teamApprovalCreated:
    "Запрос на одобрение создан (approvalId={id}, taskId={taskId}); ожидается одобрение пользователя.",
  teamApprovalExpiry:
    " Одобрение действует {minutes} мин. и допускает одно использование.",
  teamReviewNote: " (Примечание проверки: {reason})",
  teamQuestionBound:
    "Ошибка: question должен содержать видимый текст и не более 1000 символов. Задайте один полный и краткий вопрос.",
  teamQuestionPrepared: "Вопрос подготовлен к атомарной фиксации.",
  teamInputWaiting: "Ожидается ввод пользователя.",
  teamQuestionActivity: "Вопрос: {question}",
  teamQuestionStopped: "ЗАБЛОКИРОВАНО: задача остановлена; вопрос не сохранён.",
  teamQuestionSaved: "Вопрос сохранён; ожидается ответ пользователя.",
  teamNoteSaved: "Заметка сохранена.",
  teamMessageBound:
    "Ошибка: сообщение в общем канале не может содержать более 4000 символов.",
  teamChannelName: "Общий чат компании",
  teamChannelMissing: "Канал компании не найден.",
  teamMembershipMissing: "Агент не состоит в комнате компании или неактивен.",
  teamReplyMissing:
    "Сообщение общего канала, на которое дан ответ, не найдено.",
  teamMessageCooldown:
    "Между сообщениями одного агента в общем канале должно пройти не менее 5 секунд.",
  teamMessageCapacity:
    "ЗАБЛОКИРОВАНО: достигнут предел числа сообщений в общем канале (limit={limit}).",
  teamBlocked: "ЗАБЛОКИРОВАНО: {reason}",
  teamMessageFailed:
    "ЗАБЛОКИРОВАНО: не удалось сохранить сообщение общего канала.",
  teamMessageSaved:
    "Сообщение общего канала компании сохранено с вашей настоящей идентичностью отправителя (messageId={id}).",
  previewInstance: "Экземпляр процесса API: {id}",
  previewHost: "Хост: {host}",
  previewDirectory: "Начальный каталог: {path}",
  previewCommand: "Точная команда (будет выполнена без изменений):",
  previewWarning:
    "Предупреждение: скрипты или программы, вызываемые командой, могут измениться после одобрения; дочерние процессы могут продолжать работу после истечения времени ожидания командной оболочки.",
  previewPage: "Страница: {url}",
  previewUnknown: "(неизвестно)",
  previewField: "Поле: {role} · {text}",
  previewFieldDefault: "поле",
  previewUnlabeled: "(без подписи)",
  previewContext: "Контекст: {text}",
  previewText: "Текст для ввода: {text}",
  previewSubmit: "Отправить нажатием Enter: {value}",
  previewYes: "да",
  previewNo: "нет",
  previewElement: "Элемент: {role} · {text}",
  previewElementDefault: "элемент",
  previewLink: "Ссылка: {url}",
  previewForm: "Адрес отправки формы: {url}",
  judgeMissingReason: "Проверка не вернула обоснование.",
  judgeSudoReason:
    "Предложение sudo получило оценку {verdict}; точная команда показывается только при локальном одобрении человеком.",
  judgeReview: "Проверка ({purpose}): {verdict}",
  judgeCompletion: "завершение",
  judgeApproval: "запрос на одобрение",
  judgeRedacted:
    "[СКРЫТО: точная команда sudo хранится только в ожидающем одобрении]",
  judgeCompletionUnavailable:
    "Завершение безопасно остановлено, поскольку результат проверки не удалось подтвердить.",
  judgeApprovalUnavailable:
    "Сервис проверки недоступен; этот запрос может быть выполнен только после одобрения человеком.",
  judgeUnavailable: "Проверка недоступна: {verdict}",
  teamAgentReplayed:
    "Подчинённый агент уже создан; повторно он не создавался. agentId={id}",
  teamTaskReplayed:
    "Делегирование уже сохранено; повторно оно не создавалось. taskId={id}",
  teamApprovalReplayed:
    "Запрос на одобрение уже сохранён атомарно; повторно он не создавался. approvalId={id}",
  teamOperationReplayed:
    "Операция уже сохранена атомарно; повторно она не применялась.{evidence}",
  teamEvidence: " Подтверждение: {data}.",
  readReplayed:
    "Чтение уже завершено; исходное содержимое не сохранено в квитанции операции. Для получения актуальных данных запросите новое чтение.",
  readReconciled:
    "Оператор подтвердил, что чтение выполнено; оно не повторялось автоматически, а исходное содержимое не сохранялось.",
  readRetry:
    "Не удалось завершить чтение; разрешена безопасная повторная попытка.",
  teamCreateDispatch: "Создание дочернего агента",
  teamDelegateDispatch: "Делегирование задачи",
  teamProgressDispatch: "Сохранение прогресса",
  teamCompleteDispatch: "Проверка результата задачи",
  teamApprovalDispatch: "Запрос одобрения оператора",
  teamQuestionDispatch: "Запрос данных у пользователя",
  teamNoteDispatch: "Сохранение заметки с подтверждением",
  teamMessageDispatch: "Отправка сообщения в общий канал",
  toolDispatch: "Выполнение инструмента · {tool}",
  chatAnalyzing: "Анализ сообщения",
  chatPlanning: "Подготовка ответа · раунд {round}/{total}",
  taskAnalyzing: "Анализ задачи",
  taskPlanning: "Планирование · раунд {round}/{total}",
  taskModelRunning: "Выполнение запроса к модели · {model}",
  taskOwnerMissing:
    "Ответственный агент отсутствует или неактивен; задача отмечена как неудавшаяся.",
  taskLeaseMismatch: "Владельцы прав выполнения задачи и агента не совпадают.",
  modelFallback:
    "Основная модель не смогла продвинуть этот шаг; задача продолжается с разрешённой резервной моделью {model}.",
  modelRouteFailed:
    "Модель недоступна; задача пробует следующую разрешённую модель {model}.",
  taskUnknownError: "Неизвестная ошибка шага задачи.",
  taskBlocked:
    "Задача остановлена после {count} последовательных ошибок выполнения; требуется проверка оператором.",
  taskProviderRetry:
    "Попытки со всеми разрешёнными моделями завершились ошибкой; задача сохранена, повтор запланирован на {at}.",
  taskRuntimeRetry:
    "На этом шаге произошла ошибка выполнения; повтор задачи запланирован на {at}.",
  receiptLabel: "Запись операции: {id}",
  toolUnknown: "Ошибка: неизвестный инструмент '{tool}'.",
  approvedToolCompleted: "Одобренное действие завершено: {tool}.",
  approvedToolFailed: "Одобренное действие завершилось ошибкой: {tool}.",
  exclusiveTurnInstruction:
    "Пользователь явно ограничил этот ход следующими инструментами: {tools}. Не выходи за эти рамки, даже если это кажется полезным для разрешённого результата; не создавай заметки, файлы, задачи или подчинённых агентов вне этих рамок. Если разрешённых инструментов недостаточно, сообщи об этом, не расширяя область действий.",
  exclusiveSudoExactInstruction:
    "Запрашивать одобрение sudo можно только для точной команды, указанной пользователем.",
  exclusiveSudoUnavailableInstruction:
    "Не удалось безопасно определить точную команду sudo. Не используй инструмент sudo в этом ходе; сообщи о препятствии, не расширяя область действий.",
  operationReconciled: "Оператор сверил результат неопределённой операции.",
  approvalBindingInvalidated:
    "Привязка одобренного действия к браузеру больше не действительна; требуется новое одобрение.",
  judgeRunning: "Проверка задачи",
  taskAdvanceInstruction:
    "Продвинь задачу на один шаг. Оцени текущее состояние и выполни подходящие вызовы инструментов.",
  taskOpenInstruction:
    "Задача ещё открыта. Не останавливайся после объяснения: вызови следующий безопасный инструмент для конкретного действия, используй request_user_input, если нужен ответ человека, или complete_task, если доказательства подтверждают критерии приёмки.",
  taskPassiveFallbackInstruction:
    "Предыдущая модель дважды остановилась без вызова инструмента жизненного цикла задачи. Сохрани контекст и продолжи конкретным действием инструмента.",
  taskBatchFallbackInstruction:
    "Предыдущая модель превысила безопасный предел вызовов инструментов ({count}/{limit}). Сохрани задачу, соблюдай этот предел за раунд и продолжи самым безопасным конкретным действием.",
  taskLifecycleFallbackInstruction:
    "Предыдущая модель дважды вызвала инструмент жизненного цикла задачи с неверными или отклонёнными аргументами. Сохрани контекст, проверь результат и вызови инструмент с допустимыми аргументами.",
  taskToolRetryInstruction:
    "Все вызовы инструментов в этом раунде отклонены как неверные, неавторизованные или невыполненные. Исправь схему и разрешения, затем выполни ещё один конкретный допустимый вызов.",
  taskToolFallbackInstruction:
    "Предыдущая модель дважды не смогла использовать протокол инструментов. Сохрани контекст и продолжи одним конкретным действием, точно соответствующим разрешённой схеме инструмента.",
  operationCompleted: "Операция завершена: {tool}.",
  modelFailure: "{reason} ({source})",
  failureRateLimit: "Достигнут лимит запросов к модели.",
  failureTimeout: "Время ожидания ответа модели истекло.",
  failureAuthentication: "Поставщик модели отклонил аутентификацию.",
  failurePayment: "Поставщику модели требуется оплата или доступный баланс.",
  failureModelUnavailable: "Запрошенная модель недоступна.",
  failureToolCompatibility:
    "Модель не выдала пригодный ответ с требуемым протоколом инструментов.",
  failureProviderUnavailable: "Поставщик модели недоступен.",
};
