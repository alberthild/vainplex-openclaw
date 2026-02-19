import type { SignalLanguagePack } from "./types.js";

export const SIGNAL_LANG_EN: SignalLanguagePack = {
  code: "en",
  name: "English",
  nameEn: "English",

  correction: {
    indicators: [
      /\b(?:wrong|that's not right|incorrect|no that's|you're wrong|that's wrong|fix that|undo)\b/i,
      /\b(?:actually no|wait no|not what i asked|not what i meant)\b/i,
      /\b(?:you made a mistake|that's incorrect|correction)\b/i,
    ],
    shortNegatives: [
      /^\s*(?:no|nope|stop)\s*[.!]?\s*$/i,
    ],
  },

  question: {
    indicators: [
      /\b(?:shall i|should i|do you want|is that ok|okay so|right\?|is it)\b/i,
    ],
  },

  dissatisfaction: {
    indicators: [
      /\b(?:forget it|never mind|nevermind|i'?ll do it myself|this is useless|pointless|hopeless)\b/i,
      /\b(?:you can't do this|not helpful|waste of time|give up|doesn't work)\b/i,
      /\b(?:this is garbage|useless|i give up|what a waste)\b/i,
    ],
    satisfactionOverrides: [
      /\b(?:thanks|thank you|perfect|great|good job|excellent|awesome|nice)\b/i,
    ],
    resolutionIndicators: [
      /\b(?:sorry|i apologize|let me try|here'?s another|let me fix|i'?ll try again)\b/i,
    ],
  },

  completion: {
    claims: [
      /\b(?:done|completed|fixed|resolved|deployed|finished)\b/i,
      /\bi(?:'ve| have) (?:just |now )?(?:done|completed|deployed|fixed|resolved)\b/i,
      /\bit(?:'s| is| has been) (?:now )?(?:done|deployed|fixed|live|running)\b/i,
    ],
  },

  systemState: {
    claims: [
      /\b(?:disk usage|memory|cpu|load) (?:is|beträgt) (?:at )?\d+/i,
      /\b(?:service|server|daemon|process) is (?:running|stopped|active|down|inactive)\b/i,
      /\b(?:file|config) (?:exists|is present)\b/i,
      /\bthere (?:are|is) \d+ (?:errors?|warnings?|connections?|processes|files)\b/i,
      /\b(?:port|listening on) \d+\b.*is (?:open|closed|in use)\b/i,
    ],
    opinionExclusions: [
      /\b(?:i think|probably|maybe)\b/i,
      /\b(?:it seems|looks like)\b/i,
    ],
  },
};

export default SIGNAL_LANG_EN;
