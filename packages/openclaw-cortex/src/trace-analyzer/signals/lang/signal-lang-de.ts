import type { SignalLanguagePack } from "./types.js";

/**
 * German signal patterns.
 * Note: German umlauts (ä, ö, ü, ß) are NOT matched by \b in standard JS regex.
 * Patterns with purely ASCII German words can use \b; patterns with umlauts
 * use non-capturing groups or direct matching instead.
 */
export const SIGNAL_LANG_DE: SignalLanguagePack = {
  code: "de",
  name: "Deutsch",
  nameEn: "German",

  correction: {
    indicators: [
      /(?:falsch|das ist falsch|so nicht|das stimmt nicht|du hast dich geirrt)/i,
      /(?:stopp|vergiss das|das war falsch|korrektur|nochmal|das meine ich nicht)/i,
      /(?:du hast einen fehler|nicht korrekt|das ist nicht richtig)/i,
    ],
    shortNegatives: [
      /^\s*(?:nein|halt|nicht das|nö)\s*[.!]?\s*$/i,
    ],
  },

  question: {
    indicators: [
      /(?:soll ich|möchtest du|willst du|darf ich|ist das ok|passt das|oder\?|ist es)/i,
    ],
  },

  dissatisfaction: {
    indicators: [
      /(?:vergiss es|lass gut sein|lassen wir das|ich mach.s selbst|schon gut|nicht hilfreich)/i,
      /(?:das bringt nichts|hoffnungslos|sinnlos|unmöglich|du kannst das nicht)/i,
      /(?:nutzlos|zwecklos|bringt doch nichts)/i,
    ],
    satisfactionOverrides: [
      /(?:danke|vielen dank|super|perfekt|prima|passt|gut gemacht|wunderbar)/i,
    ],
    resolutionIndicators: [
      /(?:entschuldigung|tut mir leid|lass mich|ich versuche|versuch ich)/i,
    ],
  },

  completion: {
    claims: [
      /(?:erledigt|erfolg(?:reich)?|fertig|gemacht|deployed|gefixt|gelöst|abgeschlossen)/i,
      /(?:habe ich (?:jetzt |nun )?(?:gemacht|erledigt|deployed|gefixt))/i,
      /(?:ist jetzt (?:fertig|erledigt|online|aktiv))/i,
    ],
  },

  systemState: {
    claims: [
      /(?:speicherplatz|festplattenauslastung) (?:ist|beträgt|liegt bei) (?:bei )?\d+/i,
      /(?:service|server|daemon|prozess) ist (?:aktiv|gestoppt|gestartet|inaktiv|down)/i,
      /(?:datei|config) (?:existiert|ist vorhanden)/i,
      /es gibt \d+ (?:fehler|warnungen|verbindungen|prozesse|dateien)/i,
    ],
    opinionExclusions: [
      /(?:ich glaube|ich denke|wahrscheinlich|vielleicht)/i,
      /(?:es scheint|sieht aus)/i,
    ],
  },
};

export default SIGNAL_LANG_DE;
