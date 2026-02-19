import type { SignalLanguagePack } from "./types.js";

/**
 * Chinese (Simplified) signal patterns.
 * CJK: NO \b word boundaries — uses direct character sequence matching.
 */
export const SIGNAL_LANG_ZH: SignalLanguagePack = {
  code: "zh",
  name: "中文",
  nameEn: "Chinese",

  correction: {
    indicators: [
      /(?:错了|不对|错误|那不对|你搞错了|这是错的)/i,
      /(?:不是这样|不是我要的|不是我的意思|重新来)/i,
      /(?:改一下|纠正|不是那样)/i,
    ],
    shortNegatives: [
      /^\s*(?:不|不是|不要)\s*[.!。！]?\s*$/i,
    ],
  },

  question: {
    indicators: [
      /(?:要不要|需不需要|我要不要|可以吗|好吗|行吗)/i,
    ],
  },

  dissatisfaction: {
    indicators: [
      /(?:算了|不管了|随便|我自己来|没用|没有意义)/i,
      /(?:你不行|没有帮助|浪费时间|不好使|放弃了)/i,
      /(?:太差了|没希望|没用的)/i,
    ],
    satisfactionOverrides: [
      /(?:谢谢|感谢|太好了|完美|很棒|不错|好的)/i,
    ],
    resolutionIndicators: [
      /(?:抱歉|对不起|不好意思|让我再试|我重新试)/i,
    ],
  },

  completion: {
    claims: [
      /(?:完成|做好了|搞定|解决了|部署了|修好了|完了)/i,
      /(?:已经(?:完成|做好|搞定|部署|修好))/i,
      /(?:现在(?:好了|可以了|运行了|上线了))/i,
    ],
  },

  systemState: {
    claims: [
      /(?:磁盘使用率|内存|cpu|负载)(?:是|为|在)\d+/i,
      /(?:服务|服务器|守护进程|进程)(?:是|正在)(?:运行|停止|活动|关闭|不活动)/i,
      /(?:文件|配置)(?:存在|已存在)/i,
      /有\d+个(?:错误|警告|连接|进程|文件)/i,
    ],
    opinionExclusions: [
      /(?:我觉得|我认为|大概|可能|也许)/i,
      /(?:看起来|似乎|好像)/i,
    ],
  },
};

export default SIGNAL_LANG_ZH;
