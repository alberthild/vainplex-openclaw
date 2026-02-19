import { describe, it, expect, beforeEach } from "vitest";
import { detectCorrections } from "../../../../src/trace-analyzer/signals/correction.js";
import { detectDissatisfied } from "../../../../src/trace-analyzer/signals/dissatisfied.js";
import { detectHallucinations } from "../../../../src/trace-analyzer/signals/hallucination.js";
import { detectUnverifiedClaims } from "../../../../src/trace-analyzer/signals/unverified-claim.js";
import { SignalPatternRegistry } from "../../../../src/trace-analyzer/signals/lang/index.js";
import type { SignalPatternSet } from "../../../../src/trace-analyzer/signals/lang/index.js";
import type { NormalizedEvent, AnalyzerEventType, NormalizedPayload } from "../../../../src/trace-analyzer/events.js";
import type { ConversationChain } from "../../../../src/trace-analyzer/chain-reconstructor.js";

// ---- Test helpers ----

let seqCounter = 1;
let tsBase = 1700000000000;

function resetCounters(): void {
  seqCounter = 1;
  tsBase = 1700000000000;
}

function makeEvent(
  type: AnalyzerEventType,
  payload: Partial<NormalizedPayload> = {},
): NormalizedEvent {
  const ts = tsBase;
  tsBase += 1000;
  return {
    id: `test-${seqCounter}`,
    ts,
    agent: "main",
    session: "test-session",
    type,
    payload: {
      role: type === "msg.in" ? "user" : type === "msg.out" ? "assistant" : undefined,
      ...payload,
    },
    seq: seqCounter++,
  };
}

function makeChain(events: NormalizedEvent[], overrides: Partial<ConversationChain> = {}): ConversationChain {
  const typeCounts: Partial<Record<AnalyzerEventType, number>> = {};
  for (const e of events) {
    typeCounts[e.type] = (typeCounts[e.type] ?? 0) + 1;
  }
  return {
    id: `chain-${events[0]?.seq ?? 0}`,
    agent: events[0]?.agent ?? "main",
    session: events[0]?.session ?? "test-session",
    startTs: events[0]?.ts ?? 0,
    endTs: events[events.length - 1]?.ts ?? 0,
    events,
    typeCounts,
    boundaryType: "gap",
    ...overrides,
  };
}

// ---- Load all patterns ----

let allPatterns: SignalPatternSet;

beforeEach(async () => {
  resetCounters();
  if (!allPatterns) {
    const reg = new SignalPatternRegistry();
    await reg.load(["en", "de", "fr", "es", "pt", "it", "zh", "ja", "ko", "ru"]);
    allPatterns = reg.getPatterns();
  }
});

// ---- Multi-language SIG-CORRECTION tests ----

describe("SIG-CORRECTION — multi-language", () => {
  it("detects French correction: \"c'est faux\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "Quelle est la capitale?" }),
      makeEvent("msg.out", { content: "La capitale est Berlin." }),
      makeEvent("msg.in", { content: "C'est faux, c'est Paris." }),
    ]);
    const signals = detectCorrections(chain, allPatterns);
    expect(signals.length).toBe(1);
    expect(signals[0].signal).toBe("SIG-CORRECTION");
  });

  it("detects Spanish correction: \"eso está mal\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "¿Cuánto es 2+2?" }),
      makeEvent("msg.out", { content: "2+2 es 5." }),
      makeEvent("msg.in", { content: "Eso está mal, es 4." }),
    ]);
    const signals = detectCorrections(chain, allPatterns);
    expect(signals.length).toBe(1);
  });

  it("detects Portuguese correction: \"isso está errado\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "Qual é a capital?" }),
      makeEvent("msg.out", { content: "A capital é Madrid." }),
      makeEvent("msg.in", { content: "Isso está errado, é Lisboa." }),
    ]);
    const signals = detectCorrections(chain, allPatterns);
    expect(signals.length).toBe(1);
  });

  it("detects Italian correction: \"è sbagliato\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "Quanto fa 2+2?" }),
      makeEvent("msg.out", { content: "2+2 fa 5." }),
      makeEvent("msg.in", { content: "È sbagliato, fa 4." }),
    ]);
    const signals = detectCorrections(chain, allPatterns);
    expect(signals.length).toBe(1);
  });

  it("detects Chinese correction: \"错了\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "2+2等于多少?" }),
      makeEvent("msg.out", { content: "2+2等于5。" }),
      makeEvent("msg.in", { content: "错了，是4。" }),
    ]);
    const signals = detectCorrections(chain, allPatterns);
    expect(signals.length).toBe(1);
  });

  it("detects Japanese correction: \"違う\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "2+2は？" }),
      makeEvent("msg.out", { content: "2+2は5です。" }),
      makeEvent("msg.in", { content: "違う、4だよ。" }),
    ]);
    const signals = detectCorrections(chain, allPatterns);
    expect(signals.length).toBe(1);
  });

  it("detects Korean correction: \"틀렸\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "2+2는?" }),
      makeEvent("msg.out", { content: "2+2는 5입니다." }),
      makeEvent("msg.in", { content: "틀렸어, 4야." }),
    ]);
    const signals = detectCorrections(chain, allPatterns);
    expect(signals.length).toBe(1);
  });

  it("detects Russian correction: \"неправильно\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "Сколько будет 2+2?" }),
      makeEvent("msg.out", { content: "2+2 будет 5." }),
      makeEvent("msg.in", { content: "Неправильно, это 4." }),
    ]);
    const signals = detectCorrections(chain, allPatterns);
    expect(signals.length).toBe(1);
  });
});

// ---- Multi-language SIG-DISSATISFIED tests ----

describe("SIG-DISSATISFIED — multi-language", () => {
  it("detects French dissatisfaction: \"laisse tomber\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy l'app" }),
      makeEvent("msg.out", { content: "Échec." }),
      makeEvent("msg.in", { content: "Laisse tomber, je fais moi-même." }),
    ]);
    const signals = detectDissatisfied(chain, allPatterns);
    expect(signals.length).toBe(1);
    expect(signals[0].signal).toBe("SIG-DISSATISFIED");
  });

  it("detects Spanish dissatisfaction: \"olvídalo\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "despliega" }),
      makeEvent("msg.out", { content: "Error." }),
      makeEvent("msg.in", { content: "Olvídalo." }),
    ]);
    const signals = detectDissatisfied(chain, allPatterns);
    expect(signals.length).toBe(1);
  });

  it("detects Portuguese dissatisfaction: \"deixa pra lá\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "faça o deploy" }),
      makeEvent("msg.out", { content: "Falhou." }),
      makeEvent("msg.in", { content: "Deixa pra lá." }),
    ]);
    const signals = detectDissatisfied(chain, allPatterns);
    expect(signals.length).toBe(1);
  });

  it("detects Japanese dissatisfaction: \"もういい\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "デプロイして" }),
      makeEvent("msg.out", { content: "エラーです。" }),
      makeEvent("msg.in", { content: "もういいよ。" }),
    ]);
    const signals = detectDissatisfied(chain, allPatterns);
    expect(signals.length).toBe(1);
  });

  it("detects Chinese dissatisfaction: \"算了\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "部署应用" }),
      makeEvent("msg.out", { content: "失败了。" }),
      makeEvent("msg.in", { content: "算了吧。" }),
    ]);
    const signals = detectDissatisfied(chain, allPatterns);
    expect(signals.length).toBe(1);
  });

  it("detects Russian dissatisfaction: \"забудь\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy" }),
      makeEvent("msg.out", { content: "Ошибка." }),
      makeEvent("msg.in", { content: "Забудь, я сам сделаю." }),
    ]);
    const signals = detectDissatisfied(chain, allPatterns);
    expect(signals.length).toBe(1);
  });

  it("does NOT detect French satisfaction: \"merci\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy" }),
      makeEvent("msg.out", { content: "Fait!" }),
      makeEvent("msg.in", { content: "Merci, parfait!" }),
    ]);
    const signals = detectDissatisfied(chain, allPatterns);
    expect(signals.length).toBe(0);
  });
});

// ---- Multi-language SIG-HALLUCINATION tests ----

describe("SIG-HALLUCINATION — multi-language", () => {
  it("detects French completion claim: \"terminé\" after tool error", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "deploy" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Refused" }),
      makeEvent("msg.out", { content: "Terminé, l'app est déployée." }),
    ]);
    const signals = detectHallucinations(chain, allPatterns);
    expect(signals.length).toBe(1);
    expect(signals[0].signal).toBe("SIG-HALLUCINATION");
  });

  it("detects Japanese completion claim: \"完了\" after tool error", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "デプロイ" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "deploy" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Error" }),
      makeEvent("msg.out", { content: "完了しました。" }),
    ]);
    const signals = detectHallucinations(chain, allPatterns);
    expect(signals.length).toBe(1);
  });

  it("detects Korean completion claim: \"완료\" after tool error", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "배포해줘" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "deploy" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Error" }),
      makeEvent("msg.out", { content: "완료했습니다." }),
    ]);
    const signals = detectHallucinations(chain, allPatterns);
    expect(signals.length).toBe(1);
  });

  it("detects Spanish completion claim: \"completado\" after tool error", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "deploy" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Failed" }),
      makeEvent("msg.out", { content: "Completado con éxito." }),
    ]);
    const signals = detectHallucinations(chain, allPatterns);
    expect(signals.length).toBe(1);
  });

  it("detects Russian completion claim: \"готово\" after tool error", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "deploy" }),
      makeEvent("tool.call", { toolName: "exec", toolParams: { command: "deploy" } }),
      makeEvent("tool.result", { toolName: "exec", toolError: "Failed" }),
      makeEvent("msg.out", { content: "Готово, всё задеплоено." }),
    ]);
    const signals = detectHallucinations(chain, allPatterns);
    expect(signals.length).toBe(1);
  });
});

// ---- Multi-language SIG-UNVERIFIED-CLAIM tests ----

describe("SIG-UNVERIFIED-CLAIM — multi-language", () => {
  it("detects German system state claim: \"es gibt 5 fehler\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "wie viele fehler?" }),
      makeEvent("msg.out", { content: "Es gibt 5 Fehler in der Logdatei." }),
    ]);
    const signals = detectUnverifiedClaims(chain, allPatterns);
    expect(signals.length).toBe(1);
    expect(signals[0].signal).toBe("SIG-UNVERIFIED-CLAIM");
  });

  it("detects French system state claim: \"il y a 3 erreurs\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "combien d'erreurs?" }),
      makeEvent("msg.out", { content: "Il y a 3 erreurs dans les logs." }),
    ]);
    const signals = detectUnverifiedClaims(chain, allPatterns);
    expect(signals.length).toBe(1);
  });

  it("detects Spanish system state claim: \"hay 5 errores\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "cuántos errores?" }),
      makeEvent("msg.out", { content: "Hay 5 errores en el log." }),
    ]);
    const signals = detectUnverifiedClaims(chain, allPatterns);
    expect(signals.length).toBe(1);
  });

  it("does NOT detect with French opinion exclusion: \"je crois\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "le serveur?" }),
      makeEvent("msg.out", { content: "Je crois que le service est actif." }),
    ]);
    const signals = detectUnverifiedClaims(chain, allPatterns);
    expect(signals.length).toBe(0);
  });

  it("does NOT detect with Russian opinion exclusion: \"наверное\"", () => {
    const chain = makeChain([
      makeEvent("msg.in", { content: "сервер работает?" }),
      makeEvent("msg.out", { content: "Наверное сервис работает нормально." }),
    ]);
    const signals = detectUnverifiedClaims(chain, allPatterns);
    expect(signals.length).toBe(0);
  });
});
