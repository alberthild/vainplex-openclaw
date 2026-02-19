import type { SignalLanguagePack } from "./types.js";

/**
 * Korean signal patterns.
 * CJK: NO \b word boundaries — uses direct character sequence matching.
 * Agglutinative: particles attached to stems.
 */
export const SIGNAL_LANG_KO: SignalLanguagePack = {
  code: "ko",
  name: "한국어",
  nameEn: "Korean",

  correction: {
    indicators: [
      /(?:틀렸|잘못|그건 아니|맞지 않|오류)/i,
      /(?:그게 아니|내가 요청한 게 아니|그런 뜻이 아니)/i,
      /(?:다시 해|고쳐|수정해)/i,
    ],
    shortNegatives: [
      /^\s*(?:아니|아니요|안 돼|그만)\s*[.!。！]?\s*$/i,
    ],
  },

  question: {
    indicators: [
      /(?:할까요|할까|괜찮아요|좋아요\?|어때요)/i,
    ],
  },

  dissatisfaction: {
    indicators: [
      /(?:됐어|됐다|그냥 됐|내가 할게|쓸모없|의미없)/i,
      /(?:못 하는 거야|도움 안 돼|시간 낭비|안 돼|포기)/i,
      /(?:쓸데없|가망 없|무의미)/i,
    ],
    satisfactionOverrides: [
      /(?:감사합니다|감사|고마워|완벽|훌륭|잘했어|대단해)/i,
    ],
    resolutionIndicators: [
      /(?:죄송|미안|다시 시도|다시 해볼게)/i,
    ],
  },

  completion: {
    claims: [
      /(?:완료|끝|해결|배포|수정|완성|다 됐)/i,
      /(?:(?:이미|지금) (?:완료|해결|배포|수정)(?:했|됐))/i,
      /(?:(?:이제|지금) (?:됐|돌아가|온라인))/i,
    ],
  },

  systemState: {
    claims: [
      /(?:디스크 사용량|메모리|CPU|부하)(?:는|이|가) ?\d+/i,
      /(?:서비스|서버|데몬|프로세스)(?:가|는) ?(?:실행 중|중지|활성|다운|비활성)/i,
      /(?:파일|설정)(?:이|가) ?(?:존재|있)/i,
      /\d+(?:개의|개) ?(?:오류|경고|연결|프로세스|파일)(?:가 있|이 있)/i,
    ],
    opinionExclusions: [
      /(?:생각에|아마도|어쩌면|그런 것 같)/i,
      /(?:보이|듯하|같아)/i,
    ],
  },
};

export default SIGNAL_LANG_KO;
