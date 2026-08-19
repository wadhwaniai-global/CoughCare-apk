#!/usr/bin/env node
/**
 * One-command OTA publish.
 *
 *   npm run ota:test                    # publish to the tester's "CoughCare Test" app
 *   npm run ota:preview                 # publish to the LIVE FIELD FLEET (asks for confirmation)
 *   npm run ota:preview -- "my message" # with an explicit message
 *   npm run ota:production              # dormant channel, reserved for a future Play Store release
 *   npm run ota:status                  # what is live on each channel
 *
 * CHANNEL SEMANTICS (do not trust the names): the data collectors' installed
 * APKs are hard-bound to the channel named "preview", so "preview" IS the
 * de-facto production channel. Validate on "test" first. See docs/OTA.md.
 *
 * Runs the preflight checks that are easy to forget (logged in? tree clean?
 * typecheck still passing? runtimeVersion right?) and then publishes.
 *
 * Auth resolution order:
 *   1. EXPO_TOKEN environment variable
 *   2. EXPO_TOKEN in a .env file at the repo root
 *   3. An interactive `eas login` session (~/.expo/state.json)
 */

import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Number of TypeScript errors already present on a clean checkout. The publish
// is blocked only if a change *adds* to this, since the repo does not currently
// typecheck clean. Lower it as the backlog gets fixed.
const TSC_BASELINE_ERRORS = 50;

const c = {
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const step = (msg) => console.log(`\n${c.bold('▸')} ${msg}`);
const ok = (msg) => console.log(`  ${c.green('✓')} ${msg}`);
const warn = (msg) => console.log(`  ${c.yellow('!')} ${msg}`);

function die(msg, fix) {
    console.error(`\n  ${c.red('✗')} ${msg}`);
    if (fix) console.error(`\n${fix}\n`);
    process.exit(1);
}

function sh(cmd, opts = {}) {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe', ...opts }).trim();
}

/** Load EXPO_TOKEN from .env if it isn't already in the environment. */
function loadDotEnv() {
    if (process.env.EXPO_TOKEN) return 'environment';
    const envPath = resolve(ROOT, '.env');
    if (!existsSync(envPath)) return null;
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
        const m = line.match(/^\s*EXPO_TOKEN\s*=\s*(.+?)\s*$/);
        if (m) {
            process.env.EXPO_TOKEN = m[1].replace(/^["']|["']$/g, '');
            return '.env';
        }
    }
    return null;
}

const channel = process.argv[2];
const statusOnly = channel === 'status';

if (!statusOnly && !['test', 'preview', 'production'].includes(channel)) {
    die(
        `Unknown target ${JSON.stringify(channel)}`,
        '  Usage:\n' +
        '    npm run ota:test        [-- "message"]   # tester sandbox (CoughCare Test app)\n' +
        '    npm run ota:preview     [-- "message"]   # LIVE FIELD FLEET\n' +
        '    npm run ota:production  [-- "message"]   # dormant, reserved\n' +
        '    npm run ota:status',
    );
}

// ---------------------------------------------------------------- auth
step('Checking EAS authentication');
const tokenSource = loadDotEnv();
let whoami;
try {
    whoami = sh('npx --no-install eas-cli whoami 2>/dev/null || npx eas-cli whoami').split('\n').pop().trim();
} catch {
    die(
        'Not logged in to EAS.',
        '  Pick one:\n\n' +
        `    ${c.bold('npx eas-cli login')}   ${c.dim('# interactive, once per machine')}\n\n` +
        '  or put a robot token in .env at the repo root:\n\n' +
        `    ${c.bold('EXPO_TOKEN=your-token-here')}\n` +
        `    ${c.dim('(create one at expo.dev -> Account settings -> Access tokens)')}`,
    );
}
ok(`Authenticated as ${c.bold(whoami)}${tokenSource ? c.dim(` (EXPO_TOKEN from ${tokenSource})`) : ''}`);

// ------------------------------------------------------------- status
if (statusOnly) {
    step('Live updates per channel');
    const raw = sh('npx eas-cli channel:list --non-interactive --json 2>/dev/null');
    const parsed = JSON.parse(raw);
    const channels = Array.isArray(parsed) ? parsed : parsed.currentPage || [];
    for (const ch of channels) {
        console.log(`\n  ${c.bold(ch.name)}`);
        for (const b of ch.updateBranches || []) {
            const updates = (b.updateGroups || []).flat().filter((u) => u.platform === 'android');
            if (!updates.length) console.log(`    branch ${b.name}: ${c.dim('(nothing published)')}`);
            for (const u of updates) {
                // eas-cli has moved this field between versions; accept either shape
                const version = u.runtime?.version ?? u.runtimeVersion ?? '?';
                console.log(`    branch ${b.name}  rtv ${version}  ${String(u.gitCommitHash || '?').slice(0, 7)}${u.isGitWorkingTreeDirty ? c.yellow('-dirty') : ''}`);
                console.log(`      ${c.dim(u.createdAt)}  ${u.message}`);
            }
        }
    }
    console.log();
    process.exit(0);
}

// -------------------------------------------------------- runtimeVersion
step('Checking runtimeVersion');
const appConfig = readFileSync(resolve(ROOT, 'app.config.js'), 'utf8');
const rtv = appConfig.match(/runtimeVersion:\s*["']([^"']+)["']/)?.[1];
if (!rtv) die('Could not read runtimeVersion from app.config.js');
ok(`runtimeVersion ${c.bold(rtv)} — only apps built with this value will receive the update`);

// ------------------------------------------------------------ git state
step('Checking working tree');
const dirty = sh('git status --porcelain');
if (dirty) {
    die(
        'Working tree is not clean.',
        '  EAS records the commit hash with every update. Publishing dirty means the\n' +
        '  deployed bundle matches no commit anyone can check out.\n\n' +
        `  Uncommitted:\n${dirty.split('\n').map((l) => '    ' + l).join('\n')}\n\n` +
        '  Commit first, then re-run.',
    );
}
const commit = sh('git rev-parse --short HEAD');
const subject = sh('git log -1 --pretty=%s');
// Monotonic bundle sequence, shown as "#<n>" on the app's login screen.
// Comparable across channels: equal numbers mean identical code.
const bundleSeq = sh('git rev-list --count HEAD');
ok(`Clean at ${c.bold(commit)} — ${c.dim(subject)}`);
ok(`Bundle sequence ${c.bold('#' + bundleSeq)} — the app will display this number`);

// ------------------------------------------------------------- typecheck
step('Typechecking');
let errorCount = 0;
try {
    sh('npx tsc --noEmit -p tsconfig.app.json');
} catch (e) {
    const out = `${e.stdout || ''}${e.stderr || ''}`;
    errorCount = out.split('\n').filter((l) => /error TS\d+:/.test(l)).length;
}
if (errorCount > TSC_BASELINE_ERRORS) {
    die(
        `Typecheck regressed: ${errorCount} errors (baseline ${TSC_BASELINE_ERRORS}).`,
        '  See what changed:\n\n' +
        `    ${c.bold('npx tsc --noEmit -p tsconfig.app.json')}`,
    );
}
ok(errorCount === 0 ? 'No type errors' : `${errorCount} pre-existing errors, none added ${c.dim(`(baseline ${TSC_BASELINE_ERRORS})`)}`);

// --------------------------------------------------------------- publish
const extraArgs = process.argv.slice(3);
const skipConfirm = extraArgs.includes('--yes');
const message = extraArgs.filter((a) => a !== '--yes').join(' ').trim() || subject;

step(`Publishing to ${c.bold(channel)}`);
console.log(`  ${c.dim(`message: ${message}`)}`);
if (channel === 'production') {
    warn('This is the production channel — it reaches Play Store users.');
}
if (channel === 'preview') {
    warn('"preview" is the LIVE FIELD CHANNEL — every data collector\'s installed app receives this.');
    warn('It should already be verified on the "test" channel (CoughCare Test app).');
    if (!skipConfirm) {
        if (!process.stdin.isTTY) {
            die(
                'Refusing to publish to the live field channel non-interactively.',
                '  If this is intentional (e.g. CI after test-channel verification):\n\n' +
                `    ${c.bold('npm run ota:preview -- --yes')}`,
            );
        }
        const { createInterface } = await import('node:readline/promises');
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const answer = await rl.question(`\n  Type ${c.bold('preview')} to confirm the field rollout: `);
        rl.close();
        if (answer.trim() !== 'preview') {
            die('Aborted — nothing was published.');
        }
    }
}

try {
    execFileSync(
        'npx',
        // --clear-cache matters: EXPO_PUBLIC_BUNDLE_SEQ is inlined per-file at
        // Metro transform time and cached, so without it a publish where
        // buildInfo.ts didn't change would reuse the previous seq number.
        ['eas-cli', 'update', '--branch', channel, '--message', message, '--non-interactive', '--clear-cache'],
        { cwd: ROOT, stdio: 'inherit', env: { ...process.env, EXPO_PUBLIC_BUNDLE_SEQ: bundleSeq } },
    );
} catch {
    die('Publish failed — see the eas output above.');
}

console.log(`
${c.green('Published.')} It is not live on a device yet.

  ${c.bold('1.')} Fully close the app and reopen it  ${c.dim('(downloads in the background)')}
  ${c.bold('2.')} Close and reopen it once more      ${c.dim('(the new bundle now runs)')}
  ${c.bold('3.')} The line at the bottom of the login screen should show the new
     update id, e.g.  ${c.dim(`v1.0.0 · rtv ${rtv} · ${channel} · a1b2c3d4`)}

  Only apps built with runtimeVersion ${c.bold(rtv)} and channel ${c.bold(channel)} will get it.
  Full runbook: docs/OTA.md
`);
