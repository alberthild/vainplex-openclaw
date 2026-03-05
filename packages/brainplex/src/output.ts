/**
 * Terminal output module — ANSI colors & emojis, zero dependencies.
 */

let _noColor = false;

export function setNoColor(value: boolean): void {
  _noColor = value;
}

const codes = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
} as const;

type ColorName = keyof typeof codes;

export function colorize(text: string, color: ColorName): string {
  if (_noColor || process.env['NO_COLOR'] || !process.stdout.isTTY) return text;
  return `${codes[color]}${text}${codes.reset}`;
}

export function bold(text: string): string {
  return colorize(text, 'bold');
}

export function green(text: string): string {
  return colorize(text, 'green');
}

export function yellow(text: string): string {
  return colorize(text, 'yellow');
}

export function red(text: string): string {
  return colorize(text, 'red');
}

export function cyan(text: string): string {
  return colorize(text, 'cyan');
}

export function dim(text: string): string {
  return colorize(text, 'dim');
}

// ─── Structured output helpers ──────────────────────────────────────

export function header(version: string): void {
  console.log(`\n🧠 ${bold(`Brainplex v${version}`)} — OpenClaw Plugin Suite Setup\n`);
}

export function sectionHeader(emoji: string, text: string): void {
  console.log(`${emoji} ${bold(text)}`);
}

export function success(text: string): void {
  console.log(`   ${green('✓')} ${text}`);
}

export function warn(text: string): void {
  console.log(`   ${yellow('⚠')} ${text}`);
}

export function fail(text: string): void {
  console.log(`   ${red('✗')} ${text}`);
}

export function info(text: string): void {
  console.log(`     ${dim(text)}`);
}

export function separator(): void {
  console.log(`\n${'━'.repeat(48)}\n`);
}

export function done(text: string): void {
  console.log(`${green('✓')} ${bold(text)}`);
}

export function hint(text: string): void {
  console.log(`\n👉 ${text}`);
}

export function blank(): void {
  console.log('');
}
