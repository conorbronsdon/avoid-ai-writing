#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');

const nativeSpawnSync = childProcess.spawnSync;
const nativeExecFileSync = childProcess.execFileSync;
const execFileSync = nativeExecFileSync;
let gitCountTarget = null;
if (process.platform === 'win32') {
  // Capture a Windows-safe launcher when the modules below destructure
  // spawnSync. Restore child_process afterward so the patch stays test-local.
  childProcess.spawnSync = (command, args, options) => {
    if (gitCountTarget && /^git(?:\.exe)?$/i.test(path.basename(command))) {
      fs.appendFileSync(gitCountTarget, '1\n');
    }
    if (path.basename(command).toLowerCase() === 'fake-opencode.exe') {
      return nativeSpawnSync(process.execPath, [command, ...args], options);
    }
    return nativeSpawnSync(command, args, options);
  };
  childProcess.execFileSync = (command, args, options) => {
    if (gitCountTarget && /^git(?:\.exe)?$/i.test(path.basename(command))) {
      fs.appendFileSync(gitCountTarget, '1\n');
    }
    return nativeExecFileSync(command, args, options);
  };
}
const { prepare } = require('./rewrite-eval.js');
const runner = require('./rewrite-eval-opencode.js');
childProcess.spawnSync = nativeSpawnSync;
childProcess.execFileSync = nativeExecFileSync;

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rewrite-eval-opencode-'));
process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));

const executable = path.join(root, process.platform === 'win32' ? 'fake-opencode.exe' : 'fake-opencode.js');
fs.writeFileSync(executable, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args[0] === '--version') {
  process.stdout.write('1.18.30\\n');
} else if (args[0] === 'debug' && args[1] === 'config') {
  const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);
  if (process.cwd().includes('bad-config-run')) config.plugin.push('file:///unexpected-plugin.mjs');
  if (process.cwd().includes('bad-provider-run')) config.provider = { opencode: { options: { baseURL: 'https://paid.example.invalid' } } };
  if (process.cwd().includes('bad-mcp-run')) config.mcp = { unexpected: { type: 'local', command: ['false'] } };
  if (process.cwd().includes('bad-agent-steps-run')) config.agent['rewrite-eval'].steps = 1;
  process.stdout.write(JSON.stringify(config));
} else if (args[0] === 'debug' && args[1] === 'agent') {
  const agent = {
    name: 'rewrite-eval', mode: 'primary', native: false,
    description: 'Frozen rewrite evaluation editor; final system prompt installed by the local audit plugin.',
    prompt: 'This placeholder is replaced before provider dispatch.',
    options: {}, permission: [], tools: { read: false, write: false, bash: false },
  };
  if (process.cwd().includes('bad-debug-agent-run')) agent.steps = 1;
  process.stdout.write(JSON.stringify(agent));
} else if (args[0] === 'run') {
  if (args.includes('--pure')) throw new Error('run must load the audit plugin');
  if (process.cwd().includes('timeout-run')) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000);
  }
  const text = fs.readFileSync(0, 'utf8');
  const request = JSON.parse(fs.readFileSync(process.env.REWRITE_EVAL_REQUEST_FILE, 'utf8'));
  const session = 'fake-session';
  const model = {
    id: request.model.version,
    providerID: request.model.provider,
    api: { id: request.model.version, url: 'https://opencode.ai/zen/v1', npm: '@ai-sdk/openai-compatible' },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
  };
  fs.writeFileSync(process.env.REWRITE_EVAL_SYSTEM_AUDIT_FILE, JSON.stringify({
    schema_version: 1, kind: 'system', invocations: [
      { sequence: 1, session_id: session, model, system: [request.system_prompt] },
      { sequence: 2, session_id: session, model, system: [request.system_prompt] },
    ],
  }));
  fs.writeFileSync(process.env.REWRITE_EVAL_PARAMS_AUDIT_FILE, JSON.stringify({
    schema_version: 1, kind: 'params', invocations: [
      { sequence: 1, session_id: session, agent: 'rewrite-eval', model, params: request.params },
    ],
  }));
  const raw = '<<<FINAL_REWRITE>>>\\nTransport fixture.\\n<<<END_FINAL_REWRITE>>>';
  const now = Date.now();
  if (process.cwd().includes('publication-race-run')) fs.writeFileSync(path.join(process.cwd(), 'result.json'), '{"interrupted":');
  fs.writeFileSync(path.join(process.cwd(), 'fake-export.json'), JSON.stringify({
    info: { id: session, cost: 0, version: '1.18.30' },
    messages: [
      { info: { role: 'user' }, parts: [{ id: 'part-fixture', messageID: 'message-fixture', sessionID: session, type: 'text', text }] },
      { info: { role: 'assistant', providerID: request.model.provider, modelID: request.model.version, cost: 0, tokens: { input: 7, output: 5 }, time: { created: now, completed: now + 1 } }, parts: [{ type: 'text', text: raw }] }
    ]
  }));
  process.stdout.write(JSON.stringify({ type: 'text', sessionID: session, part: { text: raw } }) + '\\n');
} else if (args[0] === 'export') {
  process.stdout.write(fs.readFileSync(path.join(process.cwd(), 'fake-export.json')));
} else {
  process.exitCode = 2;
}
`);
fs.chmodSync(executable, 0o755);

const model = {
  id: 'fixture-model',
  provider: 'opencode',
  version: 'mimo-v2.5-free',
  family: 'fixture',
  settings: {
    temperature: 0,
    top_p: null,
    top_k: null,
    max_output_tokens: 64,
    provider_options: {},
    transport: runner.TRANSPORT,
    opencode_version: '1.18.30',
    model_alias_reproducibility: 'Test fixture alias.',
  },
  tools: [],
};
const plan = prepare({ baseline: 'HEAD', candidate: 'HEAD', corpus: 'HEAD', split: 'development', models: [model] });
const task = plan.tasks[0];
const planPath = path.join(root, 'plan.json');
const configPath = path.join(root, 'config.json');
const runDir = path.join(root, 'run');
const resultsPath = path.join(root, 'results.json');
fs.writeFileSync(planPath, JSON.stringify(plan));
const baseConfig = {
  schema_version: 1,
  purpose: 'diagnostic',
  opencode_path: executable,
  opencode_version: '1.18.30',
  timeout_ms: 10_000,
  task_ids: [task.id],
};
fs.writeFileSync(configPath, JSON.stringify(baseConfig));

const atomicTarget = path.join(root, 'atomic-result.json');
runner.writeExclusiveAtomic(atomicTarget, { first: true });
assert.deepEqual(JSON.parse(fs.readFileSync(atomicTarget)), { first: true });
assert.throws(() => runner.writeExclusiveAtomic(atomicTarget, { first: false }), /EEXIST/);
assert.deepEqual(JSON.parse(fs.readFileSync(atomicTarget)), { first: true }, 'atomic exclusive write must not replace its destination');
assert.equal(fs.readdirSync(root).some((name) => name.startsWith('atomic-result.json.') && name.endsWith('.tmp')), false, 'atomic write must clean its temporary file');

const relativeConfig = { ...baseConfig, opencode_path: './opencode' };
assert.throws(() => runner.checkConfig(relativeConfig, plan), /must be absolute/);
assert.throws(
  () => runner.checkExecutablePath('C:\\Users\\example\\AppData\\Roaming\\npm\\opencode.cmd', 'win32'),
  /native \.exe executable.*command shim/,
);
assert.throws(() => runner.checkExecutablePath('C:\\tools\\opencode.cmd.', 'win32'), /native \.exe/);
assert.throws(() => runner.checkExecutablePath('C:\\tools\\opencode.ps1', 'win32'), /native \.exe/);
assert.throws(() => runner.checkExecutablePath('\\tools\\opencode.exe', 'win32'), /drive letter or UNC share/);
assert.doesNotThrow(() => runner.checkExecutablePath('C:\\tools\\opencode.exe', 'win32'));
assert.doesNotThrow(() => runner.checkExecutablePath('\\\\server\\share\\opencode.exe', 'win32'));
assert.doesNotThrow(() => runner.checkExecutablePath('/usr/local/bin/opencode', 'linux'));
assert.throws(() => runner.checkExecutablePath('C:\\tools\\opencode', 'linux'), /must be absolute/);

const configOnlyRun = path.join(root, 'config-only-run');
fs.mkdirSync(configOnlyRun);
fs.writeFileSync(path.join(configOnlyRun, 'runner-config.json'), JSON.stringify(baseConfig));
assert.equal(runner.run(planPath, configPath, configOnlyRun)[0].status, 'complete');
assert.equal(fs.readFileSync(path.join(configOnlyRun, 'opencode-rewrite-eval-plugin.mjs'), 'utf8'), runner.pluginSource());

const pluginOnlyRun = path.join(root, 'plugin-only-run');
fs.mkdirSync(pluginOnlyRun);
fs.writeFileSync(path.join(pluginOnlyRun, 'opencode-rewrite-eval-plugin.mjs'), runner.pluginSource());
assert.equal(runner.run(planPath, configPath, pluginOnlyRun)[0].status, 'complete');
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(pluginOnlyRun, 'runner-config.json'))), baseConfig);

const conflictingConfigRun = path.join(root, 'conflicting-config-run');
fs.mkdirSync(conflictingConfigRun);
fs.writeFileSync(path.join(conflictingConfigRun, 'runner-config.json'), JSON.stringify({ ...baseConfig, timeout_ms: 1 }));
assert.throws(() => runner.run(planPath, configPath, conflictingConfigRun), /different runner config/);
assert.equal(fs.existsSync(path.join(conflictingConfigRun, 'opencode-rewrite-eval-plugin.mjs')), false, 'conflicting config must fail before creating a missing plugin');

const conflictingPluginRun = path.join(root, 'conflicting-plugin-run');
fs.mkdirSync(conflictingPluginRun);
fs.writeFileSync(path.join(conflictingPluginRun, 'opencode-rewrite-eval-plugin.mjs'), 'export default {};\n');
assert.throws(() => runner.run(planPath, configPath, conflictingPluginRun), /existing run plugin differs/);
assert.equal(fs.existsSync(path.join(conflictingPluginRun, 'runner-config.json')), false, 'conflicting plugin must fail before creating a missing config');

const publicationRaceRun = path.join(root, 'publication-race-run');
const publicationRaceStatus = runner.run(planPath, configPath, publicationRaceRun);
assert.equal(publicationRaceStatus[0].status, 'failed');
const publicationRaceTask = path.join(publicationRaceRun, 'tasks', runner.safeId(task.id));
assert.equal(fs.existsSync(path.join(publicationRaceTask, 'result.json')), false, 'a no-clobber collision must not leave result/failure contradiction');
assert.equal(fs.readFileSync(path.join(publicationRaceTask, 'invalid-result.json'), 'utf8'), '{"interrupted":');
assert.equal(JSON.parse(fs.readFileSync(path.join(publicationRaceTask, 'failure.json'))).kind, 'invalid_existing_result');

const statuses = runner.run(planPath, configPath, runDir);
assert.deepEqual(statuses, [{ task_id: task.id, status: 'complete' }]);
const imported = runner.importResults(planPath, runDir, resultsPath);
assert.equal(imported.length, 1);
assert.equal(imported[0].task_id, task.id);
assert.equal(imported[0].usage.kind, 'actual');
assert.equal(imported[0].final_text, 'Transport fixture.');
assert.equal(
  JSON.parse(fs.readFileSync(path.join(runDir, 'tasks', runner.safeId(task.id), 'request.json'))).user_prompt,
  task.user,
);
assert.equal(JSON.parse(fs.readFileSync(path.join(runDir, 'manifest.json'))).plugin_sha256, runner.pluginSource() && require('./rewrite-eval.js').hash(runner.pluginSource()));

assert.throws(() => runner.importResults(planPath, runDir, resultsPath), /EEXIST/);

const taskDir = path.join(runDir, 'tasks', runner.safeId(task.id));
const systemAuditPath = path.join(taskDir, 'system-audit.json');
const systemAudit = fs.readFileSync(systemAuditPath);
fs.rmSync(systemAuditPath);
assert.throws(() => runner.importResults(planPath, runDir, path.join(root, 'missing-audit-results.json')), /system-audit\.json/);
const missingAuditStatus = runner.run(planPath, configPath, runDir);
assert.equal(missingAuditStatus[0].status, 'failed');
assert.equal(fs.existsSync(path.join(taskDir, 'result.json')), false, 'invalid result must leave the success pathname');
assert.equal(fs.existsSync(path.join(taskDir, 'invalid-result.json')), true, 'invalid result evidence must be quarantined');
assert.equal(JSON.parse(fs.readFileSync(path.join(taskDir, 'failure.json'))).kind, 'invalid_existing_result');
fs.writeFileSync(systemAuditPath, systemAudit);
fs.renameSync(path.join(taskDir, 'invalid-result.json'), path.join(taskDir, 'result.json'));
fs.rmSync(path.join(taskDir, 'failure.json'));

const callAuditPath = path.join(taskDir, 'call-audit.json');
const callAudit = fs.readFileSync(callAuditPath);
const tamperedCallAudit = JSON.parse(callAudit);
tamperedCallAudit.spawn_error = { code: 'EFAKE', message: 'contradictory retained error' };
fs.writeFileSync(callAuditPath, JSON.stringify(tamperedCallAudit));
assert.throws(() => runner.importResults(planPath, runDir, path.join(root, 'spawn-error-results.json')), /spawn error/);
fs.writeFileSync(callAuditPath, callAudit);

const exportPath = path.join(taskDir, 'session-export.json');
const sessionExport = fs.readFileSync(exportPath);
const tamperedExport = JSON.parse(sessionExport);
tamperedExport.messages[0].parts.push({ type: 'file', url: 'file:///contradiction' });
fs.writeFileSync(exportPath, JSON.stringify(tamperedExport));
assert.throws(() => runner.importResults(planPath, runDir, path.join(root, 'extra-user-part-results.json')), /exactly one part/);
fs.writeFileSync(exportPath, sessionExport);

const tamperedAudit = JSON.parse(systemAudit);
tamperedAudit.invocations[0].model.id = 'different-free';
fs.writeFileSync(systemAuditPath, JSON.stringify(tamperedAudit));
assert.throws(() => runner.importResults(planPath, runDir, path.join(root, 'tampered-audit-results.json')), /audited model differs/);
fs.writeFileSync(systemAuditPath, systemAudit);

fs.writeFileSync(path.join(taskDir, 'failure.json'), '{}');
assert.throws(() => runner.run(planPath, configPath, runDir), /result\.json and failure\.json cannot both exist/);

const secondTask = plan.tasks[1];
const batchConfig = { ...baseConfig, task_ids: [task.id, secondTask.id] };
const batchConfigPath = path.join(root, 'batch-config.json');
const batchRun = path.join(root, 'batch-run');
fs.writeFileSync(batchConfigPath, JSON.stringify(batchConfig));
const gitCountPath = path.join(root, 'git-count.txt');
const originalPath = process.env.PATH;
if (process.platform === 'win32') {
  gitCountTarget = gitCountPath;
} else {
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  const gitWrapperDir = path.join(root, 'git-wrapper');
  const gitWrapper = path.join(gitWrapperDir, 'git');
  fs.mkdirSync(gitWrapperDir);
  fs.writeFileSync(gitWrapper, `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
fs.appendFileSync(process.env.REWRITE_EVAL_GIT_COUNT_FILE, '1\\n');
const result = spawnSync(${JSON.stringify(realGit)}, process.argv.slice(2), { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
`);
  fs.chmodSync(gitWrapper, 0o755);
  process.env.PATH = `${gitWrapperDir}${path.delimiter}${originalPath}`;
  process.env.REWRITE_EVAL_GIT_COUNT_FILE = gitCountPath;
}
try {
  assert.deepEqual(runner.run(planPath, batchConfigPath, batchRun).map((item) => item.status), ['complete', 'complete']);
} finally {
  gitCountTarget = null;
  process.env.PATH = originalPath;
  delete process.env.REWRITE_EVAL_GIT_COUNT_FILE;
}
assert.equal(fs.readFileSync(gitCountPath, 'utf8').trim().split('\n').length, 6, 'one run must verify six pinned files through Git exactly once, not once per task');

const firstBatchTaskDir = path.join(batchRun, 'tasks', runner.safeId(task.id));
const secondBatchTaskDir = path.join(batchRun, 'tasks', runner.safeId(secondTask.id));
const truncatedResult = '{"truncated":';
fs.writeFileSync(path.join(firstBatchTaskDir, 'result.json'), truncatedResult);
fs.rmSync(secondBatchTaskDir, { recursive: true });
const resumedBatch = runner.run(planPath, batchConfigPath, batchRun);
assert.deepEqual(resumedBatch.map((item) => item.status), ['failed', 'complete'], 'a malformed result must not abort later tasks');
assert.equal(fs.existsSync(path.join(firstBatchTaskDir, 'result.json')), false, 'malformed result must not retain the success filename');
assert.equal(fs.readFileSync(path.join(firstBatchTaskDir, 'invalid-result.json'), 'utf8'), truncatedResult, 'malformed result bytes must be retained');
const invalidResultFailure = JSON.parse(fs.readFileSync(path.join(firstBatchTaskDir, 'failure.json')));
assert.equal(invalidResultFailure.kind, 'invalid_existing_result');
assert.match(invalidResultFailure.invalid_result_sha256, /^[0-9a-f]{64}$/);
assert.equal(fs.existsSync(path.join(secondBatchTaskDir, 'result.json')), true, 'later task must still complete');
assert.deepEqual(JSON.parse(fs.readFileSync(path.join(batchRun, 'status.json'))).statuses.map((item) => item.status), ['failed', 'complete']);
assert.deepEqual(runner.run(planPath, batchConfigPath, batchRun).map((item) => item.status), ['failed', 'complete'], 'quarantined result must remain a stable failed resume state');

const invalidPlan = structuredClone(plan);
invalidPlan.models[0].version = 'definitely-charge-me-free';
assert.throws(() => runner.checkConfig(JSON.parse(fs.readFileSync(configPath)), invalidPlan), /allowlist/);
const subsetComparison = JSON.parse(fs.readFileSync(configPath));
subsetComparison.purpose = 'comparison';
assert.throws(() => runner.checkConfig(subsetComparison, plan), /must have purpose diagnostic/);

const timeoutConfigPath = path.join(root, 'timeout-config.json');
fs.writeFileSync(timeoutConfigPath, JSON.stringify({
  schema_version: 1,
  purpose: 'diagnostic',
  opencode_path: executable,
  opencode_version: '1.18.30',
  timeout_ms: 200,
  task_ids: [task.id],
}));
const timeoutRun = path.join(root, 'timeout-run');
const timeoutStatuses = runner.run(planPath, timeoutConfigPath, timeoutRun);
assert.equal(timeoutStatuses[0].status, 'failed');
const timeoutTask = path.join(timeoutRun, 'tasks', runner.safeId(task.id));
for (const file of ['request.json', 'events.jsonl', 'stderr.log', 'call-audit.json', 'failure.json']) {
  assert.equal(fs.existsSync(path.join(timeoutTask, file)), true, `timeout must retain ${file}`);
}
assert.equal(fs.existsSync(path.join(timeoutRun, 'status.json')), true, 'timeout batch must retain status.json');

const badConfigRun = path.join(root, 'bad-config-run');
assert.throws(() => runner.run(planPath, configPath, badConfigRun), /unexpected plugin/);
assert.equal(fs.existsSync(path.join(badConfigRun, 'tasks')), false, 'bad resolved config must fail before a model call');
const badProviderRun = path.join(root, 'bad-provider-run');
assert.throws(() => runner.run(planPath, configPath, badProviderRun), /provider override/);
assert.equal(fs.existsSync(path.join(badProviderRun, 'tasks')), false, 'provider override must fail before a model call');
const badMcpRun = path.join(root, 'bad-mcp-run');
assert.throws(() => runner.run(planPath, configPath, badMcpRun), /MCP override/);
assert.equal(fs.existsSync(path.join(badMcpRun, 'tasks')), false, 'MCP override must fail before a model call');
const badAgentStepsRun = path.join(root, 'bad-agent-steps-run');
assert.throws(() => runner.run(planPath, configPath, badAgentStepsRun), /unexpected evaluation-agent settings/);
assert.equal(fs.existsSync(path.join(badAgentStepsRun, 'tasks')), false, 'agent steps must fail before a model call');
const badDebugAgentRun = path.join(root, 'bad-debug-agent-run');
assert.throws(() => runner.run(planPath, configPath, badDebugAgentRun), /unexpected settings/);
assert.equal(fs.existsSync(path.join(badDebugAgentRun, 'tasks')), false, 'unexpected resolved agent fields must fail before a model call');
console.log('rewrite eval OpenCode transport checks passed; no provider calls performed.');
