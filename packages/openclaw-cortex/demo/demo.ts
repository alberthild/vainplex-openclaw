#!/usr/bin/env npx tsx
/**
 * @vainplex/openclaw-cortex — Interactive Demo
 *
 * Walk through a realistic bilingual conversation step-by-step,
 * then try your own messages and see Cortex process them live.
 *
 * Run:  npx tsx demo/demo.ts
 */

import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createInterface } from "node:readline";
import { ThreadTracker } from "../src/thread-tracker.js";
import { DecisionTracker } from "../src/decision-tracker.js";
import { BootContextGenerator } from "../src/boot-context.js";
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

function msgLine(sender: string, text: string) {
  const color = sender === "albert" ? GREEN : MAGENTA;
  const label = sender === "albert" ? "👤 Albert" : "🤖 Claudia";
  console.log(`  ${color}${label}:${RESET} ${text}`);
}

function stat(label: string, value: string) {
  console.log(`    ${BLUE}${label}:${RESET} ${value}`);
}

// ── Readline ──

const rl = createInterface({ input: process.stdin, output: process.stdout });

function ask(prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function pressEnter(hint = "Press Enter to continue...") {
  await ask(`\n  ${DIM}${hint}${RESET}`);
}

// ── Thread/Decision Display ──

function showThreads() {
  const threads = threadTracker.getThreads();
  const open = threads.filter(t => t.status === "open");
  const closed = threads.filter(t => t.status === "closed");

  console.log(`\n  ${BOLD}Threads:${RESET} ${threads.length} total (${GREEN}${open.length} open${RESET}, ${DIM}${closed.length} closed${RESET})\n`);

  const prioEmoji: Record<string, string> = { critical: "🔴", high: "🟠", medium: "🟡", low: "🔵" };

  for (const t of threads) {
    const icon = t.status === "open" ? `${GREEN}●${RESET}` : `${DIM}○${RESET}`;
    console.log(`  ${icon} ${prioEmoji[t.priority] ?? "⚪"} ${BOLD}${t.title}${RESET}`);
    stat("Status", t.status);
    stat("Priority", t.priority);
    stat("Mood", t.mood);
    if (t.decisions.length > 0) stat("Decisions", t.decisions.join(" | "));
    if (t.waiting_for) stat("Waiting for", t.waiting_for);
    console.log();
  }
}

function showDecisions() {
  const decisions = decisionTracker.getDecisions();
  console.log(`\n  ${BOLD}Decisions:${RESET} ${decisions.length} extracted\n`);

  for (const d of decisions) {
    const color = d.impact === "high" ? RED : YELLOW;
    console.log(`  🎯 ${BOLD}${d.what.slice(0, 80)}${RESET}`);
    stat("Impact", `${color}${d.impact}${RESET}`);
    stat("Who", d.who);
    console.log();
  }
}

function showMood() {
  const mood = threadTracker.getSessionMood();
  const emoji: Record<string, string> = {
    frustrated: "😤", excited: "🔥", tense: "⚡",
    productive: "🔧", exploratory: "🔬", neutral: "😐",
  };
  console.log(`  ${BOLD}Session mood:${RESET} ${emoji[mood] ?? "😐"} ${mood}`);
}

// ── Sample Conversation ──

const CONVERSATION: Array<{ sender: string; text: string; note?: string }> = [
  { sender: "albert", text: "Let's get back to the auth migration. We need to switch from JWT to OAuth2.", note: "Thread 1 opens — Cortex detects 'auth migration' as a topic" },
  { sender: "claudia", text: "I'll start with the token validation layer. The plan is to keep backward compatibility for 2 weeks.", note: "Decision detected: backward compat plan" },
  { sender: "albert", text: "Agreed. We decided to use Auth0 as the provider.", note: "Decision detected: Auth0 choice" },
  { sender: "albert", text: "Also, jetzt zu dem Performance-Bug. Die API braucht 3 Sekunden für simple Queries.", note: "Thread 2 opens — topic switch detected (German)" },
  { sender: "claudia", text: "Ich hab den Profiler laufen lassen. Das Problem ist der N+1 Query im User-Resolver." },
  { sender: "albert", text: "Mist, das ist nervig. Wir brauchen das bis Freitag gefixt.", note: "Mood shift: frustration detected" },
  { sender: "claudia", text: "Wir machen Batched DataLoader. Der Plan ist erst den User-Resolver zu fixen, dann die restlichen.", note: "Decision: DataLoader approach" },
  { sender: "albert", text: "Beschlossen. Und wir warten auf den Review von Alexey bevor wir deployen.", note: "Decision: review gate before deploy" },
  { sender: "claudia", text: "Auth migration is done ✅ All tests green, backward compat verified.", note: "Thread 1 auto-closes — closure signal detected" },
  { sender: "albert", text: "Nice! Perfekt gelaufen. 🚀" },
  { sender: "albert", text: "Now about the Kubernetes cluster — we need to plan the migration from Docker Compose.", note: "Thread 3 opens" },
  { sender: "claudia", text: "I'll draft an architecture doc. Waiting for the cost estimate from Hetzner first.", note: "Blocking item detected: waiting for Hetzner" },
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

  // ═══════════════════════════════════════════════════
  // PHASE 1: Step through sample conversation
  // ═══════════════════════════════════════════════════

  heading("Phase 1: Sample Conversation (step-by-step)");
  console.log(`${DIM}  Walk through a bilingual dev conversation.`);
  console.log(`  After each message, Cortex processes it in real-time.`);
  console.log(`  Press Enter to advance each message.${RESET}`);

  for (let i = 0; i < CONVERSATION.length; i++) {
    const { sender, text, note } = CONVERSATION[i];

    await ask(`  ${DIM}[${i + 1}/${CONVERSATION.length}] Enter ▸${RESET} `);

    msgLine(sender, text);

    threadTracker.processMessage(text, sender);
    decisionTracker.processMessage(text, sender);

    if (note) {
      console.log(`         ${CYAN}↳ ${note}${RESET}`);
    }
  }

  // ═══════════════════════════════════════════════════
  // PHASE 2: Show what Cortex extracted
  // ═══════════════════════════════════════════════════

  await pressEnter("Press Enter to see what Cortex extracted...");

  heading("Phase 2: What Cortex Found");

  subheading("Thread Tracking");
  showThreads();

  await pressEnter();

  subheading("Decision Extraction");
  showDecisions();

  subheading("Mood Detection");
  showMood();

  // ═══════════════════════════════════════════════════
  // PHASE 3: Pre-Compaction + Boot Context
  // ═══════════════════════════════════════════════════

  await pressEnter("Press Enter for pre-compaction snapshot & boot context...");

  heading("Phase 3: Pre-Compaction Snapshot");
  console.log(`${DIM}  When OpenClaw compacts the session, Cortex saves everything first.${RESET}\n`);

  const pipeline = new PreCompaction(workspace, config, logger, threadTracker);
  const messages = CONVERSATION.map(c => ({
    role: c.sender === "albert" ? "user" : "assistant",
    content: c.text,
  }));
  const result = pipeline.run(messages);

  stat("Success", result.success ? `${GREEN}yes${RESET}` : `${RED}no${RESET}`);
  stat("Messages snapshotted", String(result.messagesSnapshotted));

  heading("Phase 4: Boot Context (BOOTSTRAP.md)");
  console.log(`${DIM}  On next session start, Cortex assembles this dense briefing:${RESET}\n`);

  const bootContext = new BootContextGenerator(workspace, config.bootContext, logger);
  const bootstrap = bootContext.generate();
  bootContext.write();

  for (const line of bootstrap.split("\n")) {
    console.log(`  ${DIM}│${RESET} ${line}`);
  }
  console.log();
  stat("Total chars", String(bootstrap.length));
  stat("Approx tokens", String(Math.round(bootstrap.length / 4)));

  // ═══════════════════════════════════════════════════
  // PHASE 5: Interactive Sandbox
  // ═══════════════════════════════════════════════════

  await pressEnter("Press Enter to try your own messages...");

  heading("Phase 5: Interactive Sandbox");
  console.log(`  Type messages as if you're chatting with an AI assistant.`);
  console.log(`  Cortex processes each one in real-time.\n`);
  console.log(`  ${BOLD}Commands:${RESET}`);
  console.log(`    ${GREEN}/threads${RESET}    — show current threads`);
  console.log(`    ${GREEN}/decisions${RESET}  — show extracted decisions`);
  console.log(`    ${GREEN}/mood${RESET}       — show session mood`);
  console.log(`    ${GREEN}/boot${RESET}       — regenerate boot context`);
  console.log(`    ${GREEN}/files${RESET}      — list generated files`);
  console.log(`    ${GREEN}/quit${RESET}       — exit demo\n`);

  while (true) {
    const input = await ask(`  ${GREEN}you ▸${RESET} `);
    const trimmed = input.trim();

    if (!trimmed) continue;

    if (trimmed === "/quit" || trimmed === "/exit" || trimmed === "/q") {
      break;
    }

    if (trimmed === "/threads") {
      showThreads();
      continue;
    }

    if (trimmed === "/decisions") {
      showDecisions();
      continue;
    }

    if (trimmed === "/mood") {
      showMood();
      continue;
    }

    if (trimmed === "/boot") {
      const bg = new BootContextGenerator(workspace, config.bootContext, logger);
      const ctx = bg.generate();
      bg.write();
      console.log();
      for (const line of ctx.split("\n")) {
        console.log(`  ${DIM}│${RESET} ${line}`);
      }
      console.log(`\n    ${BLUE}chars:${RESET} ${ctx.length}  ${BLUE}tokens:${RESET} ~${Math.round(ctx.length / 4)}`);
      continue;
    }

    if (trimmed === "/files") {
      const files = [
        "memory/reboot/threads.json",
        "memory/reboot/decisions.json",
        "memory/reboot/narrative.md",
        "memory/reboot/hot-snapshot.md",
        "BOOTSTRAP.md",
      ];
      console.log();
      for (const file of files) {
        const fullPath = join(workspace, file);
        if (existsSync(fullPath)) {
          const content = readFileSync(fullPath, "utf-8");
          stat(file, `${content.length} bytes`);
        }
      }
      console.log(`\n  ${DIM}Workspace: ${workspace}${RESET}`);
      continue;
    }

    // Process as a user message
    threadTracker.processMessage(trimmed, "user");
    decisionTracker.processMessage(trimmed, "user");

    // Show immediate feedback
    const threads = threadTracker.getThreads();
    const decisions = decisionTracker.getDecisions();
    const mood = threadTracker.getSessionMood();

    const moodEmoji: Record<string, string> = {
      frustrated: "😤", excited: "🔥", tense: "⚡",
      productive: "🔧", exploratory: "🔬", neutral: "😐",
    };

    console.log(`         ${CYAN}↳ threads: ${threads.length} | decisions: ${decisions.length} | mood: ${moodEmoji[mood] ?? "😐"} ${mood}${RESET}`);
  }

  // ── Footer ──

  console.log(`
${BOLD}${CYAN}━━━ Demo Complete ━━━${RESET}

${DIM}Files written to: ${workspace}
Explore: ls -la ${workspace}/memory/reboot/${RESET}

${BOLD}Install:${RESET}  npm install @vainplex/openclaw-cortex
${BOLD}Docs:${RESET}     https://github.com/alberthild/vainplex-openclaw
`);

  rl.close();
}

run().catch(console.error);
