// Runs the benchmark: `npm run bench` measures this tree, and
// `npm run bench -- --compare <dir>` measures it against the package checked
// out at `<dir>` (master, in CI), printing a table of both. Node runs this file
// as it is, so it imports nothing it would have to compile: Node's modules, and
// `compare.ts`, which Node runs as it is too.
//
//   --compare <dir>   the package root to measure against
//   --samples <n>     processes per side for the time rows (default 11)
//   --report <file>   also writes the table, as Markdown, to <file>
//   --write           writes BENCH.md from this tree's rows
//
// It exits with 1 when a project of this tree failed, and with 2 when only the
// comparison failed: a count grew, a row of the base is missing from this tree,
// or a project of the base failed. The `bench-accepted` label lets the second
// pass in CI.
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { change, flagOf, median, spreadOf, THRESHOLD } from './compare.ts';

type Kind = 'count' | 'size' | 'time' | 'heap';
type Row = { id: string; kind: Kind; unit: string; value: number };
type Subject = 'master' | 'head';
type Project = 'counts' | 'times' | 'heap' | 'kit';
type Measured = { kind: Kind; unit: string; values: number[] };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'bench/out');
const KINDS: Kind[] = ['count', 'size', 'time', 'heap'];

/** Whether a row of `kind` is read from samples of its own processes. */
const sampled = (kind: Kind) => kind === 'time' || kind === 'heap';

const { values: args } = parseArgs({
  options: {
    compare: { type: 'string' },
    samples: { type: 'string', default: '11' },
    report: { type: 'string' },
    write: { type: 'boolean', default: false },
  },
});

const samples = Number(args.samples);
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { name: string; version: string };
const name = pkg.name.split('/').pop() ?? pkg.name;
const sources: Partial<Record<Subject, string>> = { head: join(ROOT, 'src') };

if (args.compare) {
  const master = resolve(args.compare);
  const install = join(ROOT, 'node_modules');
  const modules = join(master, 'node_modules');
  const entry = lstatSync(modules, { throwIfNoEntry: false });

  // The tree measured against resolves its imports from this one's install, so
  // both run on the same dependencies: a link left by an earlier run, dangling
  // or to another tree's install, is replaced.
  if (entry && !entry.isSymbolicLink()) {
    console.warn(`${modules} is an install of its own: the base runs on its dependencies.`);
  } else if (!entry || !existsSync(modules) || realpathSync(modules) !== realpathSync(install)) {
    if (entry) rmSync(modules);
    symlinkSync(install, modules, 'junction');
  }

  sources.master = join(master, 'src');
}

const subjects = Object.keys(sources) as Subject[];
const failed: Record<Subject, Set<Project>> = { master: new Set(), head: new Set() };

/** Runs one project against one subject in a process of its own and reads back its rows. */
const run = (subject: Subject, project: Project, sample: number): Row[] => {
  const out = join(OUT, subject, `${project}-${sample}`);

  rmSync(out, { recursive: true, force: true });

  const { status } = spawnSync(process.execPath, [join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.bench.config.ts'], {
    cwd: ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, NODE_ENV: 'production', BENCH_PROJECT: project, BENCH_SOURCE: sources[subject], BENCH_OUT: out },
  });

  if (status !== 0) failed[subject].add(project);

  return existsSync(out) ? readdirSync(out).flatMap((file) => JSON.parse(readFileSync(join(out, file), 'utf8')) as Row[]) : [];
};

const measured: Record<Subject, Map<string, Measured>> = { master: new Map(), head: new Map() };

const add = (subject: Subject, rows: Row[]) => rows.forEach(({ id, kind, unit, value }) => {
  const entry = measured[subject].get(id) ?? { kind, unit, values: [] };

  entry.values.push(value);
  measured[subject].set(id, entry);
});

// Counts and sizes are the same on every run, so one run of each side does.
for (const subject of subjects) add(subject, run(subject, 'counts', 0));

// Times and heap readings alternate between the sides, each sample in a fresh
// process, so a drift of the machine lands on both.
for (let sample = 0; sample < samples; sample++) {
  const order = sample % 2 ? [...subjects].reverse() : subjects;

  for (const subject of order) {
    for (const project of ['times', 'heap', 'kit'] as const) add(subject, run(subject, project, sample));
  }
}

const format = (value: number, unit: string) => {
  if (unit === 'ms' || unit === 'µs') return `${value.toLocaleString('en-US', { maximumSignificantDigits: 3 })} ${unit}`;

  return `${Math.round(value).toLocaleString('en-US')} ${unit}`;
};

const spread = ({ values, unit }: Measured) => (values.length > 1 ? spreadOf(values).map((bound) => format(bound, unit)).join(' to ') : '');

type Line = { id: string; kind: Kind; master?: Measured; head?: Measured; flag: string; delta: string };

const compare = (id: string): Line => {
  const master = measured.master.get(id);
  const head = measured.head.get(id);
  const kind = (head ?? master)!.kind;

  if (!head) return { id, kind, master, flag: 'missing', delta: '' };

  if (!master) return { id, kind, head, flag: args.compare ? 'new' : '', delta: '' };

  const [from, to] = [median(master.values), median(head.values)];
  const share = change(from, to);
  // A heap reading can sit at zero, where a share means nothing.
  const delta = from === to ? '0' : `${to > from ? '+' : ''}${format(to - from, head.unit)}${Number.isFinite(share) && kind !== 'heap' ? ` (${to > from ? '+' : ''}${(100 * share).toFixed(1)}%)` : ''}`;

  return { id, kind, master, head, delta, flag: flagOf(kind, master.values, head.values) };
};

const ids = [...new Set([...measured.head.keys(), ...measured.master.keys()])];
const lines = KINDS.flatMap((kind) => ids.map(compare).filter((line) => line.kind === kind));

const grew = lines.filter(({ flag }) => flag === 'grew, fails');
const missing = lines.filter(({ flag }) => flag === 'missing');
const review = lines.filter(({ flag }) => flag.endsWith('review'));

const cell = (text: string) => text.replaceAll('|', '\\|');
const value = (entry?: Measured) => (entry ? format(median(entry.values), entry.unit) : 'n/a');

const table = args.compare
  ? [
    '| Row | Kind | Master | Head | Delta | Spread (master; head) | Flag |',
    '| --- | --- | ---: | ---: | ---: | --- | --- |',
    ...lines.map((line) => `| ${cell(line.id)} | ${line.kind} | ${value(line.master)} | ${value(line.head)} | ${line.delta} | ${sampled(line.kind) ? [line.master, line.head].map((entry) => (entry ? spread(entry) : 'n/a')).join('; ') : ''} | ${line.flag} |`),
  ]
  : [
    '| Row | Kind | Value | Spread |',
    '| --- | --- | ---: | --- |',
    ...lines.map((line) => `| ${cell(line.id)} | ${line.kind} | ${value(line.head)} | ${line.head ? spread(line.head) : ''} |`),
  ];

const compared = failed.master.size + missing.length + grew.length;

const verdict = [
  ...[...failed.head].map((project) => `- **Failed:** the ${project} project of this branch. The job fails.`),
  ...[...failed.master].map((project) => `- **Failed on the base:** the ${project} project; a row it did not measure reads n/a.`),
  ...missing.map(({ id }) => `- **Missing on head:** ${id}.`),
  grew.length ? `- **${grew.length} count${grew.length === 1 ? '' : 's'} grew.**` : '',
  compared && !failed.head.size ? '- The job fails on the comparison unless the PR carries the `bench-accepted` label.' : '',
  review.length ? `- ${review.length} row${review.length === 1 ? '' : 's'} to review: a size that grew, a time beyond its spread by ${100 * THRESHOLD}% or more, or a heap reading that grew beyond its spread. None of them fails the job.` : '',
].filter(Boolean);

const environment = `Node ${process.version}, ${platform()} ${arch()}; times and heap readings are medians of ${samples} process${samples === 1 ? '' : 'es'}${args.compare ? ' per side' : ''}, a time each the median of its rounds; a spread leaves out the lowest and the highest quarter of them, rounded down.`;

const report = [
  `<!-- bench:${name} -->`,
  `## Benchmark: \`${pkg.name}\``,
  '',
  args.compare ? 'This branch against its base.' : 'This tree.',
  environment,
  '',
  ...(verdict.length ? [...verdict, ''] : args.compare ? ['No count grew, and no size, time or heap reading changed beyond its threshold.', ''] : []),
  ...table,
  '',
].join('\n');

console.log(`\n${report}`);

if (args.report) writeFileSync(resolve(args.report), report);

if (args.write) {
  const section = (kind: Kind, title: string, blurb: string) => {
    const rows = lines.filter((line) => line.kind === kind && line.head);

    return [
      `## ${title}`,
      '',
      blurb,
      '',
      ...(sampled(kind) ? ['| Row | Median | Spread |', '| --- | ---: | --- |'] : ['| Row | Value |', '| --- | ---: |']),
      ...rows.map((line) => `| ${cell(line.id)} | ${value(line.head)} |${sampled(kind) ? ` ${spread(line.head!)} |` : ''}`),
      '',
    ];
  };

  writeFileSync(join(ROOT, 'BENCH.md'), [
    '# Benchmark',
    '',
    `What \`npm run bench\` measured on \`${pkg.name}\` ${pkg.version}, written by the release that published it. A pull request compares its branch with its base in a comment; this file keeps the figures of each release beside its code.`,
    '',
    environment,
    '',
    ...section('count', 'Counts', 'Calls, keys, effect runs and checker instantiations: the same on every machine. A pull request that grows one fails its benchmark job unless it carries the `bench-accepted` label.'),
    ...section('size', 'Sizes', 'Bytes: the same on every machine.'),
    ...section('time', 'Times', 'Milliseconds and microseconds, of one machine at one time: compare them only with figures measured beside them.'),
    ...section('heap', 'Heap', 'Bytes of heap retained, read in a process of their own without V8\'s compilers: they move by a few bytes from process to process, differ from one Node version to another, and a reading near zero, on either side of it, means nothing retained.'),
  ].join('\n'));
}

if (failed.head.size) process.exitCode = 1;
else if (compared) process.exitCode = 2;
