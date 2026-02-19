import type { SignalLanguagePack } from "./types.js";

/**
 * Japanese signal patterns.
 * CJK: NO \b word boundaries — uses direct character sequence matching.
 * Mixed scripts: hiragana + kanji + katakana.
 */
export const SIGNAL_LANG_JA: SignalLanguagePack = {
  code: "ja",
  name: "日本語",
  nameEn: "Japanese",

  correction: {
    indicators: [
      /(?:違う|間違い|それは違|正しくない|不正解)/i,
      /(?:それじゃない|頼んだのと違う|そういう意味じゃない)/i,
      /(?:やり直し|訂正して|直して)/i,
    ],
    shortNegatives: [
      /^\s*(?:いいえ|いや|ダメ|やめて)\s*[.!。！]?\s*$/i,
    ],
  },

  question: {
    indicators: [
      /(?:しましょうか|しますか|いいですか|よろしいですか|どうですか)/i,
    ],
  },

  dissatisfaction: {
    indicators: [
      /(?:もういい|いいよ|どうでもいい|自分でやる|使えない|意味がない)/i,
      /(?:できないのか|役に立たない|時間の無駄|動かない|諦め)/i,
      /(?:ダメだ|望みがない|無駄だ)/i,
    ],
    satisfactionOverrides: [
      /(?:ありがとう|ありがとうございます|完璧|素晴らしい|すごい|いいね|よくできた)/i,
    ],
    resolutionIndicators: [
      /(?:すみません|申し訳|ごめんなさい|もう一度試し|やり直し)/i,
    ],
  },

  completion: {
    claims: [
      /(?:完了|完成|できた|解決した|デプロイした|修正した|終わった)/i,
      /(?:(?:もう|今)(?:完了|完成|デプロイ|修正)(?:した|しました))/i,
      /(?:(?:もう|今)(?:できた|動いて|オンラインに))/i,
    ],
  },

  systemState: {
    claims: [
      /(?:ディスク使用率|メモリ|CPU|負荷)(?:は|が)\d+/i,
      /(?:サービス|サーバー|デーモン|プロセス)(?:は|が)(?:稼働中|停止|アクティブ|ダウン|非アクティブ)/i,
      /(?:ファイル|設定)(?:が存在|は存在|がある)/i,
      /\d+(?:個|件)の(?:エラー|警告|接続|プロセス|ファイル)(?:がある|があり)/i,
    ],
    opinionExclusions: [
      /(?:思う|たぶん|かもしれない|おそらく|多分)/i,
      /(?:みたい|ようだ|らしい)/i,
    ],
  },
};

export default SIGNAL_LANG_JA;
