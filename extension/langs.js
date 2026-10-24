// Subtitle (translation) languages. Same list as server/translate.py TARGETS: all checked against the three
// free translators. Codes are ISO 639-1 (also used for the read-aloud voice).
export const TARGETS = {
  en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian", pt: "Portuguese",
  nl: "Dutch", pl: "Polish", uk: "Ukrainian", cs: "Czech", ro: "Romanian", hu: "Hungarian",
  el: "Greek", bg: "Bulgarian", sr: "Serbian", sv: "Swedish", fi: "Finnish", tr: "Turkish",
  az: "Azerbaijani", kk: "Kazakh", uz: "Uzbek", ky: "Kyrgyz", tg: "Tajik", hy: "Armenian",
  ka: "Georgian", he: "Hebrew", ar: "Arabic", fa: "Persian", hi: "Hindi", bn: "Bengali",
  ur: "Urdu", id: "Indonesian", ms: "Malay", vi: "Vietnamese", th: "Thai", zh: "Chinese",
  ja: "Japanese", ko: "Korean",
};
// Yandex word matching (learning colors) works for these (same as server ALIGNED); others show plain text.
export const ALIGNED = new Set(["en", "es", "fr", "de", "it", "pt", "pl", "uk", "cs", "bg", "sr", "tr", "az", "kk", "uz", "ky",
  "tg", "hy", "he"]);
export const RTL = new Set(["ar", "fa", "he", "ur"]);
export const langName = (code) => TARGETS[code] || "English";
