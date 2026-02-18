#!/usr/bin/env npx tsx
/**
 * @vainplex/openclaw-cortex — Interactive Demo
 *
 * Simulates a realistic conversation between a developer (Albert) and an AI assistant (Claudia).
 * Shows how Cortex automatically tracks threads, extracts decisions, detects mood,
 * and generates boot context — all from plain conversation text.
 *
 * Run:  npx tsx demo/demo.ts
 */

import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ThreadTracker } from "../src/thread-tracker.js";
import { DecisionTracker } from "../src/decision-tracker.js";
import { BootContextGenerator } from "../src/boot-context.js";
import { NarrativeGenerator } from "../src/narrative-generator.js";
import { PreCompaction } from "../src/pre-compaction.js";
import { resolveConfig } from "../src/config.js";

// ── Setup ──

const workspace = mkdtempSync(join(tmpdir(), "cortex-demo-"));
const config = resolveConfig({ workspace });

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

const threadTracker = new ThreadTracker(workspace, config.threadTracker, "both", logger);
const decisionTracker = new DecisionTracker(workspace, config.decisionTracker, "both", logger);

// ── Colors ──

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const BLUE = "\x1b[34m";
const RED = "\x1b[31m";

function heading(text: string) {
  console.log(`\n${BOLD}${CYAN}━━━ ${text} ━━━${RESET}\n`);
}

function subheading(text: string) {
  console.log(`  ${BOLD}${YELLOW}▸ ${text}${RESET}`);
}

function msg(sender: string, text: string) {
  const color = sender === "albert" ? GREEN : MAGENTA;
  const label = sender === "albert" ? "👤 Albert" : "🤖 Claudia";
  console.log(`  ${color}${label}:${RESET} ${DIM}${text}${RESET}`);
}

function stat(label: string, value: string) {
  console.log(`    ${BLUE}${label}:${RESET} ${value}`);
}

function pause(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ── Conversation ──

const CONVERSATION: Array<{ sender: string; text: string }> = [
  // Thread 1: Auth Migration
  { sender: "albert", text: "Let's get back to the auth migration. We need to switch from JWT to OAuth2." },
  { sender: "claudia", text: "I'll start with the token validation layer. The plan is to keep backward compatibility for 2 weeks." },
  { sender: "albert", text: "Agreed. We decided to use Auth0 as the provider." },

  // Thread 2: Performance Bug
  { sender: "albert", text: "Also, jetzt zu dem Performance-Bug. Die API braucht 3 Sekunden für simple Queries." },
  { sender: "claudia", text: "Ich hab den Profiler laufen lassen. Das Problem ist der N+1 Query im User-Resolver." },
  { sender: "albert", text: "Mist, das ist nervig. Wir brauchen das bis Freitag gefixt." },

  // Decision on Performance
  { sender: "claudia", text: "Wir machen Batched DataLoader. Der plan ist erst den User-Resolver zu fixen, dann die restlichen." },
  { sender: "albert", text: "Beschlossen. Und wir warten auf den Review von Alexey bevor wir deployen." },

  // Thread 1: Closure
  { sender: "claudia", text: "Auth migration is done ✅ All tests green, backward compat verified." },
  { sender: "albert", text: "Nice! Perfekt gelaufen. 🚀" },

  // Thread 3: New topic
  { sender: "albert", text: "Now about the Kubernetes cluster — we need to plan the migration from Docker Compose." },
  { sender: "claudia", text: "I'll draft an architecture doc. Waiting for the cost estimate from Hetzner first." },

  // Pre-compaction simulation
  { sender: "albert", text: "Guter Fortschritt heute. Lass uns morgen mit dem K8s-Plan weitermachen." },
];

// ── Main ──

async function run() {
  console.log(`
${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   🧠  @vainplex/openclaw-cortex — Interactive Demo           ║
║                                                              ║
║   Conversation Intelligence for OpenClaw                     ║
║   Thread Tracking · Decision Extraction · Boot Context       ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝${RESET}

${DIM}Workspace: ${workspace}${RESET}
`);

  // ── Phase 1: Simulate Conversation ──

  heading("Phase 1: Live Conversation Processing");
  console.log(`${DIM}  Cortex listens to every message via OpenClaw hooks.${RESET}`);
  console.log(`${DIM}  Here we simulate a bilingual dev conversation (EN/DE).${RESET}\n`);

  for (const { sender, text } of CONVERSATION) {
    msg(sender, text);
    threadTracker.processMessage(text, sender);
    decisionTracker.processMessage(text, sender);
    await pause(150);
  }

  // ── Phase 2: Thread State ──

  heading("Phase 2: Thread Tracking Results");

  const threads = threadTracker.getThreads();
  const openThreads = threads.filter(t => t.status === "open");
  const closedThreads = threads.filter(t => t.status === "closed");

  console.log(`  Found ${BOLD}${threads.length} threads${RESET} (${GREEN}${openThreads.length} open${RESET}, ${DIM}${closedThreads.length} closed${RESET})\n`);

  for (const t of threads) {
    const statusIcon = t.status === "open" ? `${GREEN}●${RESET}` : `${DIM}○${RESET}`;
    const prioEmoji: Record<string, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵" };
    console.log(`  ${statusIcon} ${prioEmoji[t.priority] ?? "⚪"} ${BOLD}${t.title}${RESET}`);
    stat("Status", t.status);
    stat("Priority", t.priority);
    stat("Mood", t.mood);
    if (t.decisions.length > 0) stat("Decisions", t.decisions.join(" | "));
    if (t.waiting_for) stat("Waiting for", t.waiting_for);
    console.log();
  }

  // ── Phase 3: Decision Log ──

  heading("Phase 3: Decision Extraction");

  const decisions = decisionTracker.getDecisions();
  console.log(`  Extracted ${BOLD}${decisions.length} decisions${RESET} from the conversation:\n`);

  for (const d of decisions) {
    const impactColor = d.impact === "high" ? RED : YELLOW;
    console.log(`  🎯 ${BOLD}${d.what.slice(0, 80)}${RESET}`);
    stat("Impact", `${impactColor}${d.impact}${RESET}`);
    stat("Who", d.who);
    stat("Date", d.date);
    console.log();
  }

  // ── Phase 4: Mood Detection ──

  heading("Phase 4: Mood Detection");

  const sessionMood = threadTracker.getSessionMood();
  const moodEmoji: Record<string, string> = {
    frustrated: "😤", excited: "🔥", tense: "⚡",
    productive: "🔧", exploratory: "🔬", neutral: "😐",
  };
  console.log(`  Session mood: ${BOLD}${moodEmoji[sessionMood] ?? "😐"} ${sessionMood}${RESET}`);
  console.log(`${DIM}  (Detected from conversation patterns — last mood match wins)${RESET}\n`);

  // ── Phase 5: Pre-Compaction Snapshot ──

  heading("Phase 5: Pre-Compaction Snapshot");
  console.log(`${DIM}  When OpenClaw compacts the session, Cortex saves everything first.${RESET}\n`);

  const pipeline = new PreCompaction(workspace, config, logger, threadTracker);
  const compactingMessages = CONVERSATION.map(c => ({
    role: c.sender === "albert" ? "user" : "assistant",
    content: c.text,
  }));
  const result = pipeline.run(compactingMessages);

  stat("Success", result.success ? `${GREEN}yes${RESET}` : `${RED}no${RESET}`);
  stat("Messages snapshotted", String(result.messagesSnapshotted));
  stat("Warnings", result.warnings.length === 0 ? "none" : result.warnings.join(", "));
  console.log();

  // Show hot snapshot
  const snapshotPath = join(workspace, "memory", "reboot", "hot-snapshot.md");
  if (existsSync(snapshotPath)) {
    subheading("Hot Snapshot (memory/reboot/hot-snapshot.md):");
    const snapshot = readFileSync(snapshotPath, "utf-8");
    for (const line of snapshot.split("\n").slice(0, 10)) {
      console.log(`    ${DIM}${line}${RESET}`);
    }
    console.log();
  }

  // ── Phase 6: Boot Context Generation ──

  heading("Phase 6: Boot Context (BOOTSTRAP.md)");
  console.log(`${DIM}  On next session start, Cortex assembles a dense briefing from all state.${RESET}\n`);

  const bootContext = new BootContextGenerator(workspace, config.bootContext, logger);
  const bootstrap = bootContext.generate();
  bootContext.write();

  // Show first 30 lines
  const lines = bootstrap.split("\n");
  for (const line of lines.slice(0, 35)) {
    console.log(`  ${DIM}│${RESET} ${line}`);
  }
  if (lines.length > 35) {
    console.log(`  ${DIM}│ ... (${lines.length - 35} more lines)${RESET}`);
  }
  console.log();
  stat("Total chars", String(bootstrap.length));
  stat("Approx tokens", String(Math.round(bootstrap.length / 4)));

  // ── Phase 7: Generated Files ──

  heading("Phase 7: Generated Files");
  console.log(`${DIM}  All output lives in {workspace}/memory/reboot/ — plain JSON + Markdown.${RESET}\n`);

  const files = [
    "memory/reboot/threads.json",
    "memory/reboot/decisions.json",
    "memory/reboot/narrative.md",
    "memory/reboot/hot-snapshot.md",
    "BOOTSTRAP.md",
  ];

  for (const file of files) {
    const fullPath = join(workspace, file);
    if (existsSync(fullPath)) {
      const content = readFileSync(fullPath, "utf-8");
      stat(file, `${content.length} bytes`);
    }
  }

  // ── Footer ──

  console.log(`
${BOLD}${CYAN}━━━ Demo Complete ━━━${RESET}

${DIM}All files written to: ${workspace}
Explore them: ls -la ${workspace}/memory/reboot/${RESET}

${BOLD}Install:${RESET}  npm install @vainplex/openclaw-cortex
${BOLD}GitHub:${RESET}   https://github.com/alberthild/openclaw-cortex
${BOLD}Docs:${RESET}     docs/ARCHITECTURE.md
`);
}

run().catch(console.error);
