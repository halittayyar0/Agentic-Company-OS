use serde::Serialize;
use serde_json::Value;
use std::sync::OnceLock;

#[derive(Clone, Copy, Serialize)]
pub(crate) struct Locale {
    pub code: &'static str,
    pub name: &'static str,
    #[serde(skip)]
    source: &'static str,
}

pub(crate) const LANGUAGES: [Locale; 7] = [
    Locale {
        code: "en",
        name: "English",
        source: include_str!("../locales/en.json"),
    },
    Locale {
        code: "tr",
        name: "Türkçe",
        source: include_str!("../locales/tr.json"),
    },
    Locale {
        code: "de",
        name: "Deutsch",
        source: include_str!("../locales/de.json"),
    },
    Locale {
        code: "ru",
        name: "Русский",
        source: include_str!("../locales/ru.json"),
    },
    Locale {
        code: "zh-CN",
        name: "简体中文",
        source: include_str!("../locales/zh-CN.json"),
    },
    Locale {
        code: "zh-TW",
        name: "繁體中文",
        source: include_str!("../locales/zh-TW.json"),
    },
    Locale {
        code: "ar",
        name: "العربية",
        source: include_str!("../locales/ar.json"),
    },
];

impl Locale {
    pub fn new(code: Option<&str>) -> Self {
        LANGUAGES
            .iter()
            .find(|language| Some(language.code) == code)
            .copied()
            .unwrap_or(LANGUAGES[0])
    }

    pub fn code(self) -> &'static str {
        self.code
    }

    pub fn rtl(self) -> bool {
        self.code == "ar"
    }

    pub fn copy(self) -> &'static Value {
        static COPY: OnceLock<[Value; LANGUAGES.len()]> = OnceLock::new();
        let copy = COPY.get_or_init(|| {
            LANGUAGES.map(|language| {
                serde_json::from_str(language.source).expect("valid built-in locale pack")
            })
        });
        &copy[LANGUAGES
            .iter()
            .position(|language| language.code == self.code)
            .unwrap_or(0)]
    }
}
