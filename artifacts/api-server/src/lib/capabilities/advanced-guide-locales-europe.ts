import type { AdvancedGuideId } from "./advanced-guides";
import { guide, type GuideText } from "./advanced-guide-text";

export const advancedDe: Record<AdvancedGuideId, GuideText> = {
  "procurement-scorecard": guide(
    "Lieferantenbewertung; Belegte Auswahlliste mit gewichteten Bewertungen, Gesamtkostenannahmen und Ausschlussgründen zur Freigabe.; Pflichtfunktionen, Budget und Beschaffungszeitraum|Angebote, Quellenstand und Kriteriengewichte; Pflichtanforderungen von Wünschen trennen|Währung, Laufzeit, Einrichtung und Support vereinheitlichen|Nur belegte Eigenschaften bewerten und fehlende Antworten markieren|Gewichtungsvarianten prüfen und Rückfragen formulieren; Gewichte ergeben 100, unbekannte Angaben erhalten keine Punkte|Ausgeschlossene Kosten nennen, Bestellung benötigt Freigabe",
  ),
  "research-watch-brief": guide(
    "Rechercheänderungen im Überblick; Datierter Bericht mit neuen Belegen, geänderten Aussagen und Fragen für die nächste manuelle Prüfung.; Themen, Quelladressen und frühere Textstände|Prüfzeitraum und Relevanzkriterien; Herausgeber, Veröffentlichungsdatum und Abrufdatum erfassen|Frühere und aktuelle Quelltexte vergleichen|Wesentliche Änderungen mit Quellenbezug gruppieren|Kurzbericht und nächsten Prüftermin vorschlagen; Veröffentlichungsdatum und Abrufdatum unterscheiden|Keine Einrichtung einer automatischen Überwachung behaupten",
  ),
  "feedback-synthesis": guide(
    "Kundenfeedback auswerten; Belegtes Themenregister mit Segmenten, Häufigkeit, Schwere und priorisierten Untersuchungsfragen.; Anonymisierte Rückmeldungen mit Quellenkennungen und Datum|Segmentdefinitionen und zu unterstützende Entscheidung; Doppelte Einsendungen entfernen, unterschiedliche Kunden erhalten|Themen codieren und widersprechende Beispiele bewahren|Einzelne Befragte je Thema und Segment zählen|Probleme anhand Häufigkeit, Schwere und Zitaten priorisieren; Zählungen stimmen mit der bereinigten Stichprobe überein|Stichprobenverzerrungen und unbelegte Verallgemeinerungen benennen",
  ),
  "source-change-review": guide(
    "Auswirkungen von Quellenänderungen; Vorher-Nachher-Tabelle mit geänderten Fakten, betroffenen Dokumenten und erforderlichen Entscheidungen.; Frühere und aktuelle Texte mit Adresse und Erfassungsdatum|Abhängige Aussagen oder Dokumente; Gleiche Seite und gleichen Umfang der Textstände bestätigen|Inhaltsänderungen von Navigationselementen trennen|Ergänzte, entfernte und eingeschränkte Aussagen zuordnen|Korrekturen mit genauen Belegstellen entwerfen; Jede Auswirkung beruht auf einem tatsächlichen Textunterschied|Fehlende Textstände als ungeprüft kennzeichnen, niemals erfinden",
  ),
  "debugging-case": guide(
    "Reproduzierbarer Fehlerfall; Diagnosepaket mit Reproduktionsschritten, Belegen, Ursachenhypothesen und Prüfplan für die kleinste Korrektur.; Erwartetes und beobachtetes Verhalten, bereinigte Protokolle|Relevante Dateien, Umgebungsversionen und Fehlerzeitpunkt; Kleinsten Reproduktionsfall aus Belegen ableiten|Eingaben entlang des fehlerhaften Codepfads verfolgen|Hypothesen ordnen und unterscheidende Prüfungen definieren|Minimale Korrektur und Regressionsszenario vorschlagen; Beobachtungen von ungeprüften Vermutungen trennen|Keine erfolgreiche Reproduktion oder Tests ohne Ausführungsbelege behaupten",
  ),
  "performance-investigation": guide(
    "Leistungsengpässe untersuchen; Engpassbericht mit Ausgangsmessungen, Ursachen, priorisiertem Versuch und Rücknahmeschwellen.; Laufzeitmessungen oder Profile mit Last und Umgebung|Latenzziel, Verkehrsmix und Ressourcenlimits; Kaltstarts, Dauerbetrieb und Ausreißer trennen|Perzentile und Durchsatz bei vergleichbarer Last vergleichen|Größten gemessenen Aufwand einer Komponente zuordnen|Eine Änderung mit Mess- und Rücknahmekriterien planen; Mittelwerte nicht mit Perzentilzielen vergleichen|Stichprobengröße nennen und ungemessene Verbesserungen als Schätzung markieren",
  ),
  "security-threat-review": guide(
    "Sicherheitsbedrohungen prüfen; Abgegrenztes Bedrohungsregister mit Vertrauensgrenzen, Belegen, Auswirkungen und sicheren Prüfschritten.; Architektur, relevanter Code und Datenempfindlichkeit|Akteure, offene Schnittstellen und bestehende Kontrollen; Dateneingänge und Vertrauensgrenzen kartieren|Berechtigungen, Eingabeverarbeitung und Geheimnisspeicherung verfolgen|Konkrete Missbrauchsszenarien aus Code oder Entwurf ableiten|Abhilfen und sichere Validierung priorisieren; Bestätigte Fehler von möglichen Bedrohungen unterscheiden|Keine Exploits ausführen, Geheimnisse offenlegen oder Konformität bescheinigen",
  ),
  "migration-rehearsal": guide(
    "Migrationsprobe planen; Checkliste mit Abhängigkeiten, Feldzuordnung, Abgleichprüfungen und Entscheidungen zur Rückkehr.; Ausgangs- und Zielschema, bereinigte Beispiele und Einschränkungen|Wartungsfenster, Verantwortliche und Rückkehranforderungen; Typen, Nullwerte, Schlüssel und ungültige Werte vergleichen|Eindeutige Zuordnungen und Ausnahmebehandlung definieren|Probelauf mit Anzahlen, Summen und Beispieldatensätzen planen|Umstellungskriterien und Rückkehrtrigger Verantwortlichen zuweisen; Zeilenanzahlen allein belegen keine korrekten Daten|Ausführung und destruktive Änderungen benötigen separate Freigabe",
  ),
  "sales-pipeline-audit": guide(
    "Vertriebspipeline prüfen; Ausnahmebericht mit Phasensummen, veralteten Chancen, fehlenden Belegen und Aufgaben für Verantwortliche.; Chancenexport mit Phase, Betrag, Zuständigkeit und letzter Aktivität|Phasendefinitionen, Währung und Berichtsdatum; Fehlende Kennungen, Beträge und ungültige Phasen prüfen|Chancen deduplizieren und nach Phase und Zuständigkeit gruppieren|Alter berechnen und Stillstand oder unbelegte Abschlussdaten markieren|Belegte Folgeaufgaben je Chance priorisieren; Unterschiedliche Währungen nicht ungeprüft summieren|Gewichtete Pipeline ist ein Szenario und kein verbuchter Umsatz",
  ),
  "cohort-retention-review": guide(
    "Kohortenbindung auswerten; Kohortentabelle mit berechtigten und zurückkehrenden Nutzern, Quoten und Beobachtungsgrenzen.; Anonymisierte Registrierungs- und relevante Aktivitätsereignisse|Kohortenintervall, Zeitzone und Bindungsdefinition; Nutzer deduplizieren und ungültige Zeitstempel bereinigen|Nutzer einer Registrierungskohorte zuordnen|Zurückkehrende einzelne Nutzer je Folgeintervall zählen|Nur vollständig beobachtete Intervalle vergleichen und Segmente erklären; Rückkehrende übersteigen nie die berechtigten Nutzer|Unvollständige Intervalle als nicht verfügbar statt null ausweisen",
  ),
  "funnel-dropoff-review": guide(
    "Abbrüche im Conversion-Funnel; Stufentabelle mit definierten Bezugsgrößen, größten Verlusten und überprüfbaren Verbesserungshypothesen.; Anonymisierte Ereignisse und geordnete Funnel-Schritte|Conversion-Zeitfenster, Zeitzone und Identitätsregeln; Ereignisnamen prüfen und Wiederholungen entfernen|Geordnete Nutzerpfade innerhalb des Zeitfensters bilden|Stufen- und Gesamtquoten mit expliziten Nennern berechnen|Größte Verluste und je einen passenden Versuch benennen; Spätere Schritte setzen erforderliche frühere Schritte voraus|Zusammenhänge nicht als bewiesene Abbruchursachen darstellen",
  ),
  "inventory-reorder-plan": guide(
    "Bestandsnachschub planen; Artikelübersicht mit Reichweite, Bedarf während der Lieferzeit, Engpässen und vorgeschlagenen Mengen.; Bestände, offene Bestellungen und Bedarfshistorie je Artikel|Lieferzeiten, Sicherheitsbestand, Packgrößen und Budget; Artikelkennungen abgleichen und reservierten Bestand trennen|Tagesbedarf schätzen, Saisonalität und dünne Daten markieren|Bestellbedarf als Maximum aus null und Lieferzeitbedarf plus Sicherheitsbestand minus nutzbarem Angebot berechnen|Mengen auf Packgrößen runden und Kapitalbedarf zeigen; Einheiten dokumentieren und Zuläufe nicht doppelt zählen|Vorschläge lösen keine Bestellungen aus",
  ),
  "client-proposal": guide(
    "Kundenangebot entwerfen; Prüfbarer Angebotsentwurf mit Ergebnissen, Umfang, Meilensteinen, Preisgrundlage und Abnahmekriterien.; Kundenproblem, Zielgruppe und vereinbarte Anforderungen|Kapazität, kaufmännische Grenzen und freigegebene Belege; Bedürfnisse in messbare Ergebnisse übersetzen|Liefergegenstände, Ausschlüsse und Kundenbeiträge festlegen|Meilensteine mit Prüfungen und Preisgrundlage aufbauen|Kurzes Angebot und offene Entscheidungen formulieren; Keine Referenzen, Qualifikationen oder Preiszusagen erfinden|Versand und kommerzielle Annahme bleiben beim Nutzer",
  ),
  "help-center-article": guide(
    "Hilfeartikel erstellen; Aufgabenbezogener Supportartikel mit Voraussetzungen, nummerierten Anweisungen und Fehlerbehebung.; Produktverhalten und bestätigte Oberflächentexte oder Bilder|Leserrolle, Berechtigungen und typische Fehler; Eine Nutzeraufgabe und ihr Erfolgsbild festlegen|Zugriffsvoraussetzungen auflisten|Aktionen in Oberflächenreihenfolge mit erwarteter Rückmeldung schreiben|Symptombasierte Hilfe und Angaben für Eskalation ergänzen; Jede Anweisung stimmt mit gelieferten Produktbelegen überein|Unbestätigtes Verhalten für die Produktprüfung markieren",
  ),
  "onboarding-sequence": guide(
    "Onboarding-Sequenz entwerfen; Gestufter Nachrichtenentwurf mit Nutzermeilensteinen, Handlung, Auslöser und Erfolgsmessung.; Zielgruppe, Aktivierungsziel und Produktfähigkeiten|Kanäle, Zeitregeln und freigegebener Ton; Kürzesten Weg zum ersten Nutzen bestimmen|Nachrichten Meilensteinen und Teilnahmebedingungen zuordnen|Je Nachricht eine klare Handlung und Hilfeoption schreiben|Stoppbedingungen und Messplan ergänzen; Nach erreichten Meilensteinen keine redundanten Nachrichten vorsehen|Der Entwurf plant oder versendet keine Kampagne automatisch",
  ),
  "editorial-calendar": guide(
    "Redaktionskalender; Datierter Inhaltsplan mit Leserbedürfnissen, Quellenanforderungen, Zuständigkeiten und Prüfterminen.; Inhaltsziele, Leserfragen und Veröffentlichungskanäle|Planungszeitraum, Teamkapazität und Freigaberegeln; Themen nach unterschiedlichen Leserbedürfnissen gruppieren|Formate und Kanäle je Thema auswählen|Produktion und Prüfung innerhalb der Kapazität terminieren|Briefings mit Beleganforderungen und Erfolgskriterien schreiben; Explizite Zeitzone und genügend Prüfzeit vorsehen|Veröffentlichung bleibt redaktioneller Freigabe vorbehalten",
  ),
  "recurring-operations-review": guide(
    "Wiederkehrende Aufgaben prüfen; Aufgabenregister mit Zuständigkeiten, Fälligkeitsregeln, Abschlussbelegen und Eskalationsschwellen.; Aufgaben, Takt, Verantwortliche und jüngste Abschlussnachweise|Berichtsdatum, Zeitzone und Eskalationsregeln; Rhythmen vereinheitlichen und Abschlussnachweise definieren|Fällige Aufgaben mit dokumentierten Abschlüssen vergleichen|Überfälligkeiten, fehlende Zuständigkeit und Blockaden identifizieren|Ausnahmebericht und nächsten Prüfzeitraum entwerfen; Fehlende Belege bedeuten keinen bestätigten Abschluss|Dieser Leitfaden richtet keine wiederkehrende Automatisierung ein",
  ),
  "launch-coordination-plan": guide(
    "Marktstart koordinieren; Startcheckliste mit Abhängigkeiten, Verantwortlichen, Freigabekriterien und Rücknahme-Kommunikationsentwurf.; Startumfang, Zieltermin und Bereitschaftsnachweise|Verantwortliche, Freigaben und Rücknahmegrenzen; Vom Starttermin entlang der Abhängigkeiten rückwärts planen|Jeder Freigabe genau eine verantwortliche Person zuweisen|Messbare Bereitschafts- und Stoppkriterien definieren|Zeitplan und Kommunikation für Störungen entwerfen; Fehlende kritische Belege verhindern die Startempfehlung|Bereitstellung und externe Ankündigungen brauchen ausdrückliche Freigabe",
  ),
  "vendor-handoff-packet": guide(
    "Lieferantenübergabe vorbereiten; Übergabeverzeichnis mit Dateien, Versionsfingerabdrücken, Zugriffsvoraussetzungen und Abnahmeverantwortung.; Vereinbarter Umfang, Lieferdateien und Vertragsanforderungen|Empfängerrolle, erlaubte Daten und Abnahmefrist; Vertragliche Ergebnisse vorhandenen Artefakten zuordnen|Dateinamen, Versionen und Hashes gelieferter Inhalte erfassen|Zugriffsvoraussetzungen nennen und unnötige sensible Daten entfernen|Übergabeanleitung und Abnahmecheckliste entwerfen; Fehlende Artefakte und ungeklärte Zugriffe sichtbar auflisten|Ohne Nutzerfreigabe keine Dateien hochladen oder teilen",
  ),
  "standard-operating-procedure": guide(
    "Standardarbeitsanweisung; Ausführbarer SOP-Entwurf mit Auslöser, Voraussetzungen, Aktionen, Ausnahmen und Abschlussbelegen.; Bestehender Prozess, Beteiligte und Fehlerbeispiele|Befugnisgrenzen, Aufzeichnungspflichten und Eskalationskontakte; Start und Ende mit Prozessverantwortung definieren|Beobachtete Arbeit in geordnete Schritte mit Ergebnissen überführen|Entscheidungen, Fehlerbehebung und Stopppunkte ergänzen|Einen Beispielfall durchgehen und offene Punkte dokumentieren; Jede Entscheidung hat eine Zuständigkeit oder Eskalationsroute|Keine Richtlinien, Befugnisse oder erfolgreichen Proben erfinden",
  ),
};

export const advancedRu: Record<AdvancedGuideId, GuideText> = {
  "procurement-scorecard": guide(
    "Оценка поставщиков; Список поставщиков с доказательствами, взвешенными баллами, допущениями полной стоимости и причинами исключения.; Обязательные функции, бюджет и срок закупки|Предложения, даты источников и веса критериев; Отделите обязательные условия от пожеланий|Приведите валюту, период, внедрение и поддержку к единой базе|Оценивайте подтвержденные функции и отмечайте пробелы|Проверьте чувствительность к весам и подготовьте вопросы; Сумма весов равна 100, неизвестные данные не получают баллов|Укажите исключенные расходы, покупку утверждает пользователь",
  ),
  "research-watch-brief": guide(
    "Обзор изменений в исследовании; Датированный обзор новых доказательств, измененных утверждений и вопросов для следующей ручной проверки.; Темы, ссылки на источники и предыдущие копии|Период обзора и критерии значимости; Запишите издателя, дату публикации и дату получения|Сравните предыдущий и текущий тексты|Сгруппируйте существенные изменения со ссылками|Подготовьте краткий обзор и дату следующей проверки; Различайте дату публикации и дату получения|Не утверждайте, что автоматический мониторинг настроен",
  ),
  "feedback-synthesis": guide(
    "Анализ отзывов клиентов; Реестр тем с сегментами, частотой, серьезностью, цитатами и приоритетными исследовательскими вопросами.; Обезличенные отзывы с идентификаторами источников и датами|Определения сегментов и целевое решение; Удалите повторные отправки, сохранив разных клиентов|Разметьте темы и сохраните противоречащие примеры|Посчитайте уникальных респондентов по темам и сегментам|Приоритизируйте проблемы по частоте и серьезности с цитатами; Итоги сходятся с очищенной выборкой|Отметьте смещение выборки и неподтвержденные обобщения",
  ),
  "source-change-review": guide(
    "Влияние изменений источника; Таблица до и после с измененными фактами, затронутыми документами и необходимыми решениями.; Предыдущий и текущий тексты с адресами и датами|Зависящие от источника утверждения или документы; Подтвердите совпадение страницы и охвата копий|Отделите содержательные изменения от навигационного шума|Свяжите добавленные, удаленные и уточненные тезисы с документами|Подготовьте исправления с точными выдержками; Каждое последствие связано с реальным текстовым различием|Отсутствующие копии помечайте непроверенными, не восстанавливайте выдумками",
  ),
  "debugging-case": guide(
    "Воспроизводимый разбор ошибки; Диагностический пакет с шагами воспроизведения, доказательствами, гипотезами и планом проверки минимального исправления.; Ожидаемое и наблюдаемое поведение, очищенные журналы|Нужные файлы, версии среды и время сбоя; Выведите минимальный сценарий из имеющихся доказательств|Проследите входные данные по сбойному участку кода|Ранжируйте гипотезы и задайте различающую проверку каждой|Предложите минимальное исправление и регрессионный сценарий; Отделяйте наблюдения от непроверенных гипотез|Не заявляйте воспроизведение или успех теста без доказательств запуска",
  ),
  "performance-investigation": guide(
    "Исследование производительности; Отчет об узких местах с исходными измерениями, вероятными причинами, экспериментом и порогами отката.; Измерения времени или профили с нагрузкой и средой|Цель задержки, состав трафика и лимиты ресурсов; Отделите холодный запуск, устойчивый режим и выбросы|Сравните перцентили и пропускную способность при одинаковой нагрузке|Свяжите крупнейшую измеренную затрату с компонентом|Спланируйте одно изменение с критериями измерения и отката; Не сравнивайте средние значения с целями по перцентилям|Укажите размер выборки, неизмеренное ускорение обозначьте оценкой",
  ),
  "security-threat-review": guide(
    "Разбор угроз безопасности; Реестр угроз в заданных границах с доказательствами, последствиями, мерами и безопасными проверками.; Архитектура, нужный код и чувствительность данных|Участники, открытые интерфейсы и существующие меры; Отметьте точки ввода данных и границы доверия|Проследите авторизацию, обработку ввода и хранение секретов|Опишите конкретные злоупотребления по коду или проекту|Приоритизируйте меры и безопасные шаги проверки; Отличайте подтвержденные дефекты от возможных угроз|Не запускайте эксплуатацию, не раскрывайте секреты и не выдавайте сертификаты",
  ),
  "migration-rehearsal": guide(
    "План репетиции миграции; Контрольный список с порядком зависимостей, правилами переноса, сверками и условиями отката.; Исходная и целевая схемы, очищенные примеры и ограничения|Окно обслуживания, ответственные и требования отката; Сравните типы, пустые значения, ключи и неподдерживаемые значения|Определите однозначные соответствия полей и обработку исключений|Спланируйте пробный перенос с количествами, суммами и примерами|Назначьте ответственных за условия перехода и отката; Одного количества строк недостаточно для проверки корректности|Запуск и разрушительные изменения требуют отдельного разрешения",
  ),
  "sales-pipeline-audit": guide(
    "Аудит воронки продаж; Отчет об исключениях с суммами по стадиям, застоявшимися сделками, пробелами и действиями ответственных.; Выгрузка сделок со стадией, суммой, владельцем и последней активностью|Определения стадий, валюта и отчетная дата; Проверьте пропуски идентификаторов, сумм и неверные стадии|Удалите дубликаты и сгруппируйте по стадии и владельцу|Рассчитайте возраст и отметьте застой или неподтвержденные даты закрытия|Подготовьте приоритетные действия с доказательствами по сделке; Не складывайте несовместимые валюты|Взвешенная воронка является сценарием, а не признанной выручкой",
  ),
  "cohort-retention-review": guide(
    "Когортный анализ удержания; Когортная таблица с доступными и вернувшимися пользователями, долями и ограничениями наблюдения.; Обезличенные регистрации и значимые события активности|Интервал когорты, часовой пояс и определение удержания; Удалите дубликаты пользователей и неверные временные метки|Назначьте каждому пользователю когорту регистрации|Посчитайте уникальных вернувшихся пользователей по прошедшим интервалам|Сравните только завершенные интервалы и объясните различия сегментов; Вернувшихся не может быть больше доступных пользователей|Незавершенный интервал означает отсутствие данных, а не нулевое удержание",
  ),
  "funnel-dropoff-review": guide(
    "Анализ потерь в воронке; Таблица конверсии по шагам с определенными знаменателями, крупнейшими потерями и проверяемыми гипотезами.; Обезличенные события и упорядоченные шаги воронки|Окно конверсии, часовой пояс и правила идентификации; Проверьте названия событий и уберите повторы|Постройте упорядоченные пути внутри окна конверсии|Рассчитайте пошаговую и общую конверсию с явными знаменателями|Найдите крупнейшие потери и предложите эксперимент для каждой; Поздние шаги требуют обязательных предыдущих шагов|Не выдавайте корреляцию за причину ухода",
  ),
  "inventory-reorder-plan": guide(
    "План пополнения запасов; Таблица по артикулам с покрытием спроса, потребностью на срок поставки, дефицитом и предлагаемым заказом.; Остатки, открытые заказы и история спроса по артикулам|Сроки поставки, страховой запас, упаковка и бюджет; Сверьте артикулы и отделите зарезервированный запас|Оцените дневной спрос, отметьте сезонность и малые выборки|Рассчитайте спрос на срок поставки плюс резерв минус доступное снабжение, с минимумом ноль|Округлите до упаковок и покажите потребность в деньгах; Укажите единицы и не учитывайте поставки дважды|Рекомендации являются черновиком и не размещают заказы",
  ),
  "client-proposal": guide(
    "Проект клиентского предложения; Предложение для проверки с результатами, границами, этапами, допущениями, ценовой базой и приемкой.; Проблема клиента, аудитория и согласованные требования|Ресурсы, коммерческие ограничения и одобренные доказательства; Переведите потребности в измеримые результаты|Определите поставку, исключения и обязанности клиента|Составьте этапы с проверками и основой расчета цены|Напишите краткое предложение и список открытых решений; Не выдумывайте квалификацию, отзывы и ценовые обязательства|Отправку и коммерческое принятие выполняет пользователь",
  ),
  "help-center-article": guide(
    "Статья справочного центра; Прикладная статья с условиями доступа, нумерованными действиями, ожидаемыми результатами и устранением ошибок.; Поведение продукта и подтвержденные подписи или снимки интерфейса|Роль читателя, разрешения и частые ошибки; Определите одну задачу и признак успеха|Перечислите доступы и предварительные условия|Опишите действия в порядке интерфейса с ожидаемым откликом|Добавьте помощь по симптомам и пакет сведений для поддержки; Каждая инструкция соответствует предоставленным доказательствам|Непроверенное поведение направьте на продуктовую проверку",
  ),
  "onboarding-sequence": guide(
    "Сценарий знакомства с продуктом; Набор сообщений по этапам с действиями, условиями запуска, пользовательскими целями и метриками успеха.; Аудитория, цель активации и функции продукта|Каналы, правила времени и одобренный стиль; Найдите кратчайший путь к первому полезному результату|Свяжите сообщения с этапами и условиями участия|Напишите каждое сообщение с одним действием и способом помощи|Добавьте условия остановки и план измерения; Не планируйте лишние сообщения после достижения этапа|Черновик не запускает и не отправляет кампанию",
  ),
  "editorial-calendar": guide(
    "Редакционный календарь; Датированный план материалов с нуждами читателя, источниками, ответственными, проверками и заданиями.; Цели контента, вопросы аудитории и каналы|Период планирования, ресурсы команды и согласования; Сгруппируйте темы по отдельным потребностям читателей|Выберите формат и канал для каждой темы|Разместите производство и проверку в пределах ресурсов|Подготовьте задания с доказательствами и критериями успеха; Укажите часовой пояс и время для проверки|Публикация ожидает редакционного одобрения",
  ),
  "recurring-operations-review": guide(
    "Проверка регулярных задач; Реестр повторяющейся работы с ответственными, сроками, доказательствами завершения и порогами эскалации.; Задачи, периодичность, владельцы и недавние записи завершения|Дата отчета, часовой пояс и правила эскалации; Нормализуйте периодичность и признаки завершения|Сопоставьте наступившие сроки с записями выполнения|Выявите просрочки, отсутствие владельца и блокировки|Подготовьте обзор исключений и следующее окно проверки; Отсутствие доказательств не подтверждает выполнение|Это руководство не создает расписание или регулярную автоматизацию",
  ),
  "launch-coordination-plan": guide(
    "План координации запуска; Список готовности с зависимостями, ответственными, условиями запуска или остановки и сообщением об откате.; Объем запуска, целевая дата и доказательства готовности|Владельцы, согласования и ограничения отката; Планируйте назад от даты запуска по зависимостям|Назначьте одного ответственного за каждый контрольный рубеж|Определите измеримую готовность и условия остановки|Подготовьте график запуска и сообщения на случай сбоев; Отсутствие критических доказательств блокирует рекомендацию запуска|Развертывание и внешние объявления требуют явного разрешения",
  ),
  "vendor-handoff-packet": guide(
    "Пакет передачи поставщику; Опись передачи с файлами, отпечатками версий, условиями доступа и ответственностью за приемку.; Согласованный объем, файлы и условия договора|Роль получателя, разрешенные данные и срок приемки; Сопоставьте каждый результат договора с имеющимся файлом|Запишите имена, версии и хеши предоставленного содержимого|Укажите доступы и удалите лишние чувствительные сведения|Подготовьте инструкции передачи и список приемки; Явно перечислите отсутствующие материалы и нерешенные доступы|Не загружайте и не передавайте файлы без разрешения пользователя",
  ),
  "standard-operating-procedure": guide(
    "Стандартная рабочая процедура; Применимый проект процедуры с запуском, предпосылками, действиями, исключениями и подтверждением завершения.; Текущий процесс, участники и примеры ошибок|Границы полномочий, обязательные записи и контакты эскалации; Определите начало, завершение и владельца процесса|Преобразуйте наблюдаемую работу в шаги с ожидаемыми результатами|Добавьте решения, восстановление после ошибок и точки остановки|Пройдите пример и запишите пробелы для проверки; У каждого решения есть ответственный или путь эскалации|Не выдумывайте политику, полномочия или успешную проверку",
  ),
};
