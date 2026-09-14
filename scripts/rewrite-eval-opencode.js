#!/usr/bin/env node
'use strict';

// Optional OpenCode Zen executor for the frozen rewrite-eval plan. The core
// harness remains provider-free; this script keeps calls and receipts in an
// operator-selected directory outside the repository.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const { checkPlan, checkResults, extractFinalText, hash } = require('./rewrite-eval.js');

const RUNNER_VERSION = 1;
const TRANSPORT = 'opencode-1.18.30-system-transform-v1';
const AGENT = 'rewrite-eval';
const OPENCODE_SOURCE_COMMIT = '3104c1428ec91f809e5ab86631300de41eb6952e';
const ZEN_API_URL = 'https://opencode.ai/zen/v1';
const ZEN_TRANSPORT_PACKAGE = '@ai-sdk/openai-compatible';
const AGENT_DESCRIPTION = 'Frozen rewrite evaluation editor; final system prompt installed by the local audit plugin.';
const AGENT_PLACEHOLDER = 'This placeholder is replaced before provider dispatch.';
const FREE_MODELS = new Set([
  'mimo-v2.5-free',
  'ling-3.0-flash-fin-free',
  'nemotron-3-ultra-free',
]);

function read(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeExclusive(file, value) {
  writeExclusiveAtomic(file, value);
}

// Publish a fully flushed inode without ever opening the destination for a
// partial write or replacing an existing artifact. The temporary hard link and
// destination are in the same directory/filesystem.
function writeExclusiveAtomic(file, value) {
  const content = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let descriptor;
  let created = false;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    created = true;
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.linkSync(temporary, file);
  } finally {
    try {
      if (descriptor !== undefined) fs.closeSync(descriptor);
    } finally {
      if (created) fs.rmSync(temporary, { force: true });
    }
  }
}

function writeAtomic(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(tmp, file);
}

function safeId(id) {
  return crypto.createHash('sha256').update(id).digest('hex').slice(0, 24);
}

function checkConfig(config, plan) {
  assert(config && typeof config === 'object' && !Array.isArray(config), 'runner config must be an object');
  assert.equal(config.schema_version, 1, 'runner config schema_version must be 1');
  assert(['diagnostic', 'comparison'].includes(config.purpose), 'runner config purpose must be diagnostic or comparison');
  assert(typeof config.opencode_path === 'string' && config.opencode_path, 'runner config opencode_path required');
  assert(path.isAbsolute(config.opencode_path), 'runner config opencode_path must be absolute');
  assert.equal(config.opencode_version, '1.18.30', 'this adapter is pinned to OpenCode 1.18.30');
  assert(Number.isInteger(config.timeout_ms) && config.timeout_ms > 0, 'runner config timeout_ms must be positive');
  if (config.task_ids !== undefined) {
    assert.equal(config.purpose, 'diagnostic', 'runner config with task_ids must have purpose diagnostic');
    assert(Array.isArray(config.task_ids) && config.task_ids.length, 'runner config task_ids must be a non-empty array when present');
    assert.equal(new Set(config.task_ids).size, config.task_ids.length, 'runner config task_ids must be unique');
    const known = new Set(plan.tasks.map((task) => task.id));
    for (const id of config.task_ids) assert(known.has(id), `unknown configured task ${id}`);
  }
  for (const model of plan.models) checkSettings(model, config.opencode_version);
}

function checkSettings(model, opencodeVersion) {
  assert.equal(model.provider, 'opencode', `${model.id}: this adapter requires provider opencode`);
  assert(FREE_MODELS.has(model.version), `${model.id}: model is not in the observed OpenCode Zen free-model allowlist`);
  const settings = model.settings;
  const allowed = new Set([
    'temperature', 'top_p', 'top_k', 'max_output_tokens', 'provider_options',
    'transport', 'opencode_version', 'model_alias_reproducibility',
  ]);
  for (const key of Object.keys(settings)) assert(allowed.has(key), `${model.id}: unsupported setting ${key}`);
  assert.equal(settings.transport, TRANSPORT, `${model.id}: settings.transport must be ${TRANSPORT}`);
  assert.equal(settings.opencode_version, opencodeVersion, `${model.id}: settings.opencode_version must match runner config`);
  assert(Number.isFinite(settings.temperature), `${model.id}: numeric temperature required`);
  assert(Number.isInteger(settings.max_output_tokens) && settings.max_output_tokens > 0, `${model.id}: positive max_output_tokens required`);
  for (const key of ['top_p', 'top_k']) {
    assert(settings[key] === null || Number.isFinite(settings[key]), `${model.id}: ${key} must be numeric or null`);
  }
  assert(settings.provider_options && typeof settings.provider_options === 'object' && !Array.isArray(settings.provider_options), `${model.id}: provider_options object required`);
  assert(typeof settings.model_alias_reproducibility === 'string' && settings.model_alias_reproducibility, `${model.id}: model_alias_reproducibility required`);
}

function effectiveParams(settings) {
  return {
    temperature: settings.temperature,
    topP: settings.top_p,
    topK: settings.top_k,
    maxOutputTokens: settings.max_output_tokens,
    options: settings.provider_options,
  };
}

// OpenCode normally adds its coding-agent and environment prompt. This local
// plugin uses OpenCode's documented plugin hook to replace the final assembled
// system array immediately before provider dispatch, and audits the values the
// hook installed. `--pure` cannot be used because it disables file plugins.
function pluginSource() {
  return `import fs from "node:fs";
const request = JSON.parse(fs.readFileSync(process.env.REWRITE_EVAL_REQUEST_FILE, "utf8"));
function save(name, value) {
  const file = process.env[\`REWRITE_EVAL_\${name}_AUDIT_FILE\`];
  const audit = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : { schema_version: 1, kind: name.toLowerCase(), invocations: [] };
  audit.invocations.push({ sequence: audit.invocations.length + 1, ...value });
  const temporary = \`\${file}.\${process.pid}.tmp\`;
  fs.writeFileSync(temporary, JSON.stringify(audit, null, 2) + "\\n", { flag: "wx" });
  fs.renameSync(temporary, file);
}
export default async () => ({
  "experimental.chat.system.transform": async (input, output) => {
    if (!input.sessionID) return;
    output.system.splice(0, output.system.length, request.system_prompt);
    save("SYSTEM", { session_id: input.sessionID, model: input.model, system: output.system });
  },
  "chat.params": async (input, output) => {
    if (input.agent !== ${JSON.stringify(AGENT)}) return;
    output.temperature = request.params.temperature;
    output.topP = request.params.topP === null ? undefined : request.params.topP;
    output.topK = request.params.topK === null ? undefined : request.params.topK;
    output.maxOutputTokens = request.params.maxOutputTokens;
    output.options = structuredClone(request.params.options);
    save("PARAMS", { session_id: input.sessionID, agent: input.agent, model: input.model, params: {
      temperature: output.temperature,
      topP: output.topP ?? null,
      topK: output.topK ?? null,
      maxOutputTokens: output.maxOutputTokens,
      options: output.options,
    }});
  },
});
`;
}

function openCodeConfig(pluginPath) {
  return {
    $schema: 'https://opencode.ai/config.json',
    share: 'disabled',
    autoupdate: false,
    enabled_providers: ['opencode'],
    instructions: [],
    permission: { '*': 'deny' },
    plugin: [pathToFileURL(pluginPath).href],
    agent: {
      [AGENT]: {
        description: AGENT_DESCRIPTION,
        mode: 'primary',
        prompt: AGENT_PLACEHOLDER,
        permission: { '*': 'deny' },
        options: {},
      },
    },
  };
}

function command(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    timeout: options.timeout,
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function requireCommand(result, label) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  assert.equal(result.status, 0, `${label}: ${result.stderr.trim()}`);
  return result;
}

function parseEvents(stdout) {
  return stdout.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); } catch (error) { throw new Error(`OpenCode event line ${index + 1} is not JSON: ${error.message}`); }
  });
}

function verifyAgent(executable, env, cwd, timeout) {
  const result = requireCommand(command(executable, ['debug', 'agent', AGENT], { env, cwd, timeout }), 'opencode debug agent failed');
  const info = JSON.parse(result.stdout);
  checkResolvedAgent(info);
  return info;
}

function checkResolvedAgent(info) {
  assert.deepEqual(Object.keys(info).sort(), [
    'description', 'mode', 'name', 'native', 'options', 'permission', 'prompt', 'tools',
  ], 'resolved evaluation agent contains unexpected settings');
  assert.equal(info.name, AGENT, 'resolved agent name differs');
  assert.equal(info.mode, 'primary', 'resolved evaluation agent must be primary');
  assert.equal(info.native, false, 'resolved evaluation agent must not be native');
  assert.equal(info.description, AGENT_DESCRIPTION, 'resolved evaluation agent description differs');
  assert.equal(info.prompt, AGENT_PLACEHOLDER, 'resolved evaluation agent placeholder prompt differs');
  assert.deepEqual(info.options, {}, 'resolved evaluation agent contains unexpected provider options');
  assert(info.tools && Object.values(info.tools).every((enabled) => enabled === false), 'resolved evaluation agent exposes a tool');
}

function verifyResolvedConfig(executable, env, cwd, timeout, pluginPath) {
  const result = requireCommand(command(executable, ['debug', 'config'], { env, cwd, timeout }), 'opencode debug config failed');
  const config = JSON.parse(result.stdout);
  checkResolvedConfig(config, pluginPath);
  return config;
}

function checkResolvedConfig(config, pluginPath) {
  assert.equal(config.share, 'disabled', 'resolved OpenCode sharing must be disabled');
  assert.equal(config.autoupdate, false, 'resolved OpenCode autoupdate must be disabled');
  assert.deepEqual(config.enabled_providers, ['opencode'], 'resolved OpenCode providers must contain only opencode');
  assert.deepEqual(config.permission, { '*': 'deny' }, 'resolved OpenCode global permission must deny everything');
  assert.deepEqual(config.plugin, [pathToFileURL(pluginPath).href], 'resolved OpenCode config contains an unexpected plugin');
  assert.deepEqual(config.instructions ?? [], [], 'resolved OpenCode config contains unexpected instructions');
  assert.equal(config.provider, undefined, 'resolved OpenCode config contains a provider override');
  assert.equal(config.mcp, undefined, 'resolved OpenCode config contains an MCP override');
  assert.deepEqual(config.agent?.[AGENT], {
    description: AGENT_DESCRIPTION,
    mode: 'primary',
    prompt: AGENT_PLACEHOLDER,
    permission: { '*': 'deny' },
    options: {},
  }, 'resolved OpenCode config contains unexpected evaluation-agent settings');
}

function tasksFor(plan, config) {
  return config.task_ids ? plan.tasks.filter((task) => config.task_ids.includes(task.id)) : plan.tasks;
}

function buildManifest(plan, config, tasks, pluginPath, resolvedConfig, agent) {
  return {
    schema_version: 1,
    runner_version: RUNNER_VERSION,
    purpose: config.purpose,
    protocol_compatible_transport: true,
    plan_hash: plan.plan_hash,
    runner_config_hash: hash(config),
    task_ids: tasks.map((task) => task.id),
    opencode_path: path.resolve(config.opencode_path),
    opencode_version: config.opencode_version,
    opencode_source_commit: OPENCODE_SOURCE_COMMIT,
    transport: TRANSPORT,
    exact_system_hook: 'experimental.chat.system.transform',
    plugin_sha256: hash(fs.readFileSync(pluginPath, 'utf8')),
    resolved_config_sha256: hash(resolvedConfig),
    resolved_agent_sha256: hash(agent),
    fresh_process_per_task: true,
    tools_policy: 'resolved custom agent has every tool disabled',
    model_alias_limitation: 'OpenCode Zen exposes moving model IDs, not immutable provider revisions.',
  };
}

function isolatedEnvironment(runDir, pluginPath) {
  const env = { ...process.env };
  for (const key of [
    'OPENCODE_CONFIG', 'OPENCODE_CONFIG_CONTENT', 'OPENCODE_CONFIG_DIR',
    'OPENCODE_DISABLE_PROJECT_CONFIG', 'OPENCODE_PERMISSION', 'OPENCODE_PURE',
  ]) delete env[key];
  const configDir = path.join(runDir, 'isolated-opencode-config');
  fs.mkdirSync(configDir, { recursive: true });
  Object.assign(env, {
    OPENCODE_CONFIG_DIR: configDir,
    OPENCODE_DISABLE_PROJECT_CONFIG: '1',
    OPENCODE_CONFIG_CONTENT: JSON.stringify(openCodeConfig(pluginPath)),
  });
  return env;
}

function initialize(planPath, configPath, runDir) {
  const plan = read(planPath);
  checkPlan(plan);
  const config = read(configPath);
  checkConfig(config, plan);
  const tasks = tasksFor(plan, config);

  fs.mkdirSync(runDir, { recursive: true });
  const manifestPath = path.join(runDir, 'manifest.json');
  const pluginPath = path.join(runDir, 'opencode-rewrite-eval-plugin.mjs');
  const runnerConfigPath = path.join(runDir, 'runner-config.json');
  if (fs.existsSync(runnerConfigPath)) assert.deepEqual(read(runnerConfigPath), config, 'existing run directory has a different runner config');
  if (fs.existsSync(pluginPath)) assert.equal(fs.readFileSync(pluginPath, 'utf8'), pluginSource(), 'existing run plugin differs');
  if (!fs.existsSync(runnerConfigPath)) writeExclusive(runnerConfigPath, config);
  if (!fs.existsSync(pluginPath)) writeExclusive(pluginPath, pluginSource());

  const env = isolatedEnvironment(runDir, pluginPath);
  const version = requireCommand(command(config.opencode_path, ['--version'], { env, cwd: runDir, timeout: config.timeout_ms }), 'opencode --version failed');
  assert.equal(version.stdout.trim(), config.opencode_version, 'OpenCode binary version differs from runner config');
  const resolvedConfigPath = path.join(runDir, 'resolved-config.json');
  const resolvedConfig = verifyResolvedConfig(config.opencode_path, env, runDir, config.timeout_ms, pluginPath);
  const agentPath = path.join(runDir, 'resolved-agent.json');
  const agent = verifyAgent(config.opencode_path, env, runDir, config.timeout_ms);
  const manifest = buildManifest(plan, config, tasks, pluginPath, resolvedConfig, agent);
  if (fs.existsSync(resolvedConfigPath)) assert.deepEqual(read(resolvedConfigPath), resolvedConfig, 'resolved OpenCode config changed during the run');
  else writeExclusive(resolvedConfigPath, resolvedConfig);
  if (fs.existsSync(agentPath)) assert.deepEqual(read(agentPath), agent, 'resolved OpenCode agent changed during the run');
  else writeExclusive(agentPath, agent);
  if (fs.existsSync(manifestPath)) assert.deepEqual(read(manifestPath), manifest, 'existing run directory belongs to a different plan, config or resolved environment');
  else writeExclusive(manifestPath, manifest);
  return { plan, config, tasks, env, pluginPath, agent, resolvedConfig, manifest };
}

function assistantFromExport(receipt, task, model) {
  assert(receipt && Array.isArray(receipt.messages), `${task.id}: invalid OpenCode session export`);
  assert.equal(receipt.messages.length, 2, `${task.id}: expected exactly one user and one assistant message in fresh session`);
  const users = receipt.messages.filter((message) => message.info?.role === 'user');
  const assistants = receipt.messages.filter((message) => message.info?.role === 'assistant');
  assert.equal(users.length, 1, `${task.id}: expected one user message in fresh session`);
  assert.equal(assistants.length, 1, `${task.id}: expected one assistant message in fresh session`);
  assert.equal(users[0].parts.length, 1, `${task.id}: persisted user message must contain exactly one part`);
  assert.equal(users[0].parts[0].type, 'text', `${task.id}: persisted user message part must be text`);
  assert.equal(users[0].parts[0].text, task.user, `${task.id}: persisted user text differs from frozen task.user`);
  const assistant = assistants[0];
  assert.equal(assistant.info.providerID, model.provider, `${task.id}: receipt provider differs`);
  assert.equal(assistant.info.modelID, model.version, `${task.id}: receipt model differs`);
  assert.equal(assistant.info.cost, 0, `${task.id}: free-model receipt reported nonzero cost`);
  assert(Number.isInteger(assistant.info.tokens?.input) && assistant.info.tokens.input >= 0, `${task.id}: actual input tokens absent`);
  assert(Number.isInteger(assistant.info.tokens?.output) && assistant.info.tokens.output >= 0, `${task.id}: actual output tokens absent`);
  return assistant;
}

function buildRequest(plan, task, model) {
  return {
    schema_version: 1,
    task_id: task.id,
    plan_hash: plan.plan_hash,
    prompt_hash: task.prompt_hash,
    system_prompt: plan.prompts[task.condition],
    user_prompt: task.user,
    model: { provider: model.provider, version: model.version },
    params: effectiveParams(model.settings),
    tools: [],
  };
}

function checkAuditModel(actual, model, where) {
  assert(actual && typeof actual === 'object', `${where}: audited model object required`);
  assert.equal(actual.providerID, model.provider, `${where}: audited provider differs`);
  assert.equal(actual.id, model.version, `${where}: audited model differs`);
  assert.deepEqual(actual.api, {
    id: model.version,
    url: ZEN_API_URL,
    npm: ZEN_TRANSPORT_PACKAGE,
  }, `${where}: audited model does not use the pinned OpenCode Zen route`);
  assert.deepEqual(actual.cost, {
    input: 0,
    output: 0,
    cache: { read: 0, write: 0 },
  }, `${where}: audited model costs are not all zero`);
}

function checkHookAudits(systemAudit, paramsAudit, request, session, model, taskId) {
  function records(audit, kind) {
    assert.deepEqual(Object.keys(audit).sort(), ['invocations', 'kind', 'schema_version'], `${taskId}: ${kind} audit envelope differs`);
    assert.equal(audit.schema_version, 1, `${taskId}: ${kind} audit schema differs`);
    assert.equal(audit.kind, kind, `${taskId}: ${kind} audit kind differs`);
    assert(Array.isArray(audit.invocations) && audit.invocations.length > 0, `${taskId}: ${kind} audit has no hook invocation`);
    audit.invocations.forEach((item, index) => assert.equal(item.sequence, index + 1, `${taskId}: ${kind} audit sequence differs`));
    return audit.invocations;
  }
  const systemInvocations = records(systemAudit, 'system');
  const paramsInvocations = records(paramsAudit, 'params');
  for (const item of systemInvocations) {
    assert.deepEqual(Object.keys(item).sort(), ['model', 'sequence', 'session_id', 'system'], `${taskId}: system audit invocation differs`);
    assert.deepEqual(item.system, [request.system_prompt], `${taskId}: system audit differs from frozen prompt`);
    assert.equal(item.session_id, session, `${taskId}: system audit belongs to another session`);
    checkAuditModel(item.model, model, `${taskId}: system audit`);
  }
  for (const item of paramsInvocations) {
    assert.deepEqual(Object.keys(item).sort(), ['agent', 'model', 'params', 'sequence', 'session_id'], `${taskId}: params audit invocation differs`);
    assert.equal(item.session_id, session, `${taskId}: params audit belongs to another session`);
    assert.equal(item.agent, AGENT, `${taskId}: params audit belongs to another agent`);
    assert.deepEqual(item.params, request.params, `${taskId}: parameter audit differs from frozen settings`);
    checkAuditModel(item.model, model, `${taskId}: params audit`);
  }
  const models = [...systemInvocations, ...paramsInvocations].map((item) => item.model);
  for (const auditedModel of models.slice(1)) {
    assert.deepEqual(auditedModel, models[0], `${taskId}: hook audits describe different models`);
  }
}

function validateTaskEvidence(plan, config, task, taskDir) {
  const model = plan.models.find((item) => item.id === task.model_id);
  assert(model, `${task.id}: model missing from plan`);
  const resultPath = path.join(taskDir, 'result.json');
  const failurePath = path.join(taskDir, 'failure.json');
  assert(!(fs.existsSync(resultPath) && fs.existsSync(failurePath)), `${task.id}: result.json and failure.json cannot both exist`);
  assert(fs.existsSync(resultPath), `${task.id}: result.json missing`);

  const request = read(path.join(taskDir, 'request.json'));
  assert.deepEqual(request, buildRequest(plan, task, model), `${task.id}: persisted request differs from frozen task`);
  const events = parseEvents(fs.readFileSync(path.join(taskDir, 'events.jsonl'), 'utf8'));
  const sessions = [...new Set(events.map((event) => event.sessionID).filter(Boolean))];
  assert.equal(sessions.length, 1, `${task.id}: expected one OpenCode session ID in events`);
  const receipt = read(path.join(taskDir, 'session-export.json'));
  assert.equal(receipt.info?.id, sessions[0], `${task.id}: session export differs from event session`);
  assert.equal(receipt.info?.version, config.opencode_version, `${task.id}: session export OpenCode version differs`);
  const assistant = assistantFromExport(receipt, task, model);
  const rawOutput = assistant.parts.filter((part) => part.type === 'text').map((part) => part.text).join('');
  const eventOutput = events.filter((event) => event.type === 'text').map((event) => event.part?.text ?? '').join('');
  assert.equal(eventOutput, rawOutput, `${task.id}: JSONL event text differs from session export`);

  const systemAudit = read(path.join(taskDir, 'system-audit.json'));
  const paramsAudit = read(path.join(taskDir, 'params-audit.json'));
  checkHookAudits(systemAudit, paramsAudit, request, sessions[0], model, task.id);

  const callAudit = read(path.join(taskDir, 'call-audit.json'));
  assert.equal(callAudit.task_id, task.id, `${task.id}: call audit belongs to another task`);
  assert.equal(callAudit.exit_status, 0, `${task.id}: call audit is not successful`);
  assert.equal(callAudit.signal, null, `${task.id}: call audit records a signal`);
  assert.equal(callAudit.spawn_error, null, `${task.id}: call audit records a spawn error`);
  assert(Number.isFinite(callAudit.duration_ms) && callAudit.duration_ms >= 0, `${task.id}: call audit duration invalid`);
  assert(Number.isFinite(Date.parse(callAudit.started_at)), `${task.id}: call audit start invalid`);
  assert(Number.isFinite(Date.parse(callAudit.recorded_at)), `${task.id}: call audit completion invalid`);

  const extracted = extractFinalText(rawOutput, plan.protocol.final_text_markers, task.id);
  const expected = {
    task_id: task.id,
    plan_hash: plan.plan_hash,
    prompt_hash: task.prompt_hash,
    provider: model.provider,
    model_version: model.version,
    raw_output: rawOutput,
    final_text: extracted.text,
    final_text_offset: extracted.offset,
    recorded_at: callAudit.recorded_at,
    duration_ms: callAudit.duration_ms,
    usage: {
      kind: 'actual',
      input_tokens: assistant.info.tokens.input,
      output_tokens: assistant.info.tokens.output,
    },
  };
  const result = read(resultPath);
  assert.deepEqual(result, expected, `${task.id}: result is not derived from the retained receipts`);
  // initialize/import already performed the Git-backed provenance check once
  // for this operation. Re-derive the plan and validate this row in memory
  // without spawning six redundant `git show` processes per task.
  checkResults(plan, [result], { git: false });
  return result;
}

function fileSha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function finishInvalidResultQuarantine(task, taskDir, failure) {
  const resultPath = path.join(taskDir, 'result.json');
  const invalidPath = path.join(taskDir, 'invalid-result.json');
  assert.equal(failure.kind, 'invalid_existing_result', `${task.id}: result/failure contradiction is not a recognized quarantine`);
  assert.equal(failure.task_id, task.id, `${task.id}: invalid-result failure belongs to another task`);
  assert(typeof failure.error === 'string' && failure.error, `${task.id}: invalid-result failure has no error`);
  assert(/^[0-9a-f]{64}$/.test(failure.invalid_result_sha256), `${task.id}: invalid-result failure has no evidence hash`);
  if (fs.existsSync(resultPath)) {
    assert.equal(fileSha256(resultPath), failure.invalid_result_sha256, `${task.id}: result changed during invalid-result quarantine`);
    if (fs.existsSync(invalidPath)) assert.equal(fileSha256(invalidPath), failure.invalid_result_sha256, `${task.id}: quarantined result differs`);
    else fs.linkSync(resultPath, invalidPath);
    fs.unlinkSync(resultPath);
  }
  assert(fs.existsSync(invalidPath), `${task.id}: quarantined invalid-result evidence missing`);
  assert.equal(fileSha256(invalidPath), failure.invalid_result_sha256, `${task.id}: quarantined result hash differs`);
  return { task_id: task.id, status: 'failed', error: failure.error };
}

function quarantineInvalidResult(task, taskDir, error) {
  const resultPath = path.join(taskDir, 'result.json');
  const failurePath = path.join(taskDir, 'failure.json');
  assert(fs.existsSync(resultPath), `${task.id}: cannot quarantine a missing result`);
  assert(!fs.existsSync(failurePath), `${task.id}: cannot create an invalid-result failure over an existing failure`);
  const failure = {
    kind: 'invalid_existing_result',
    task_id: task.id,
    recorded_at: new Date().toISOString(),
    error,
    invalid_result_sha256: fileSha256(resultPath),
    evidence_retained: [...fs.readdirSync(taskDir), 'invalid-result.json'].filter((name) => name !== 'result.json').sort(),
  };
  writeExclusive(failurePath, failure);
  return finishInvalidResultQuarantine(task, taskDir, failure);
}

function runTask(context, task) {
  const { plan, config, env, pluginPath } = context;
  const model = plan.models.find((item) => item.id === task.model_id);
  const taskDir = path.join(path.dirname(pluginPath), 'tasks', safeId(task.id));
  fs.mkdirSync(taskDir, { recursive: true });
  const resultPath = path.join(taskDir, 'result.json');
  const failurePath = path.join(taskDir, 'failure.json');
  if (fs.existsSync(failurePath)) {
    const failure = read(failurePath);
    if (failure.kind === 'invalid_existing_result') return finishInvalidResultQuarantine(task, taskDir, failure);
    if (fs.existsSync(resultPath)) throw new Error(`${task.id}: result.json and failure.json cannot both exist`);
  }
  if (fs.existsSync(resultPath)) {
    try {
      validateTaskEvidence(plan, config, task, taskDir);
      return { task_id: task.id, status: 'complete' };
    } catch (error) {
      return quarantineInvalidResult(task, taskDir, `retained result failed resume validation: ${error.message}`);
    }
  }
  if (fs.existsSync(failurePath)) return { task_id: task.id, status: 'failed' };
  const existing = fs.readdirSync(taskDir);
  if (existing.length) {
    writeExclusive(failurePath, {
      task_id: task.id,
      recorded_at: new Date().toISOString(),
      error: 'incomplete prior attempt found; use a new run directory for an explicit retry',
      evidence_retained: existing.sort(),
    });
    return { task_id: task.id, status: 'failed', error: 'incomplete prior attempt found' };
  }

  const request = buildRequest(plan, task, model);
  const requestPath = path.join(taskDir, 'request.json');
  const systemAuditPath = path.join(taskDir, 'system-audit.json');
  const paramsAuditPath = path.join(taskDir, 'params-audit.json');
  writeExclusive(requestPath, request);
  const taskEnv = {
    ...env,
    REWRITE_EVAL_REQUEST_FILE: requestPath,
    REWRITE_EVAL_SYSTEM_AUDIT_FILE: systemAuditPath,
    REWRITE_EVAL_PARAMS_AUDIT_FILE: paramsAuditPath,
  };
  // OpenCode 1.18.30 quotes positional arguments containing spaces. Supplying
  // only stdin avoids that CLI display escaping and persists task.user byte for
  // byte, which is verified again against the session export below.
  const args = ['run', '--agent', AGENT, '--model', `${model.provider}/${model.version}`, '--format', 'json', '--title', `rewrite-eval ${task.id}`];
  const startedAt = new Date().toISOString();
  const start = process.hrtime.bigint();
  const call = command(config.opencode_path, args, { env: taskEnv, cwd: taskDir, timeout: config.timeout_ms, input: task.user });
  const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
  const recordedAt = new Date().toISOString();
  writeExclusive(path.join(taskDir, 'events.jsonl'), call.stdout ?? '');
  writeExclusive(path.join(taskDir, 'stderr.log'), call.stderr ?? '');
  writeExclusive(path.join(taskDir, 'call-audit.json'), {
    task_id: task.id,
    started_at: startedAt,
    recorded_at: recordedAt,
    duration_ms: durationMs,
    exit_status: call.status,
    signal: call.signal,
    spawn_error: call.error ? { code: call.error.code, message: call.error.message } : null,
  });

  try {
    if (call.error) throw new Error(`OpenCode run failed: ${call.error.message}`);
    assert.equal(call.status, 0, call.signal ? `OpenCode terminated by ${call.signal}` : `OpenCode exited ${call.status}`);
    const events = parseEvents(call.stdout);
    const sessions = [...new Set(events.map((event) => event.sessionID).filter(Boolean))];
    assert.equal(sessions.length, 1, `${task.id}: expected one OpenCode session ID`);
    const exported = command(config.opencode_path, ['export', sessions[0], '--pure'], { env: taskEnv, cwd: taskDir, timeout: config.timeout_ms });
    requireCommand(exported, `${task.id}: opencode export failed`);
    writeExclusive(path.join(taskDir, 'session-export.json'), exported.stdout);
    const receipt = JSON.parse(exported.stdout);
    assert.equal(receipt.info?.version, config.opencode_version, `${task.id}: session export OpenCode version differs`);
    const assistant = assistantFromExport(receipt, task, model);
    const rawOutput = assistant.parts.filter((part) => part.type === 'text').map((part) => part.text).join('');
    const extracted = extractFinalText(rawOutput, plan.protocol.final_text_markers, task.id);

    const systemAudit = read(systemAuditPath);
    const paramsAudit = read(paramsAuditPath);
    checkHookAudits(systemAudit, paramsAudit, request, sessions[0], model, task.id);
    const eventOutput = events.filter((event) => event.type === 'text').map((event) => event.part?.text ?? '').join('');
    assert.equal(eventOutput, rawOutput, `${task.id}: JSONL event text differs from session export`);

    const result = {
      task_id: task.id,
      plan_hash: plan.plan_hash,
      prompt_hash: task.prompt_hash,
      provider: model.provider,
      model_version: model.version,
      raw_output: rawOutput,
      final_text: extracted.text,
      final_text_offset: extracted.offset,
      recorded_at: recordedAt,
      duration_ms: durationMs,
      usage: {
        kind: 'actual',
        input_tokens: assistant.info.tokens.input,
        output_tokens: assistant.info.tokens.output,
      },
    };
    checkResults(plan, [result], { git: false });
    writeExclusiveAtomic(resultPath, result);
    return { task_id: task.id, status: 'complete' };
  } catch (error) {
    // A no-clobber publication can report EEXIST, or cleanup can fail after a
    // successful link. Never add a contradictory failure beside result.json:
    // accept an independently valid result, otherwise quarantine its bytes.
    if (fs.existsSync(resultPath)) {
      try {
        validateTaskEvidence(plan, config, task, taskDir);
        return { task_id: task.id, status: 'complete' };
      } catch (validationError) {
        return quarantineInvalidResult(task, taskDir, `result publication failed (${error.message}); retained result is invalid: ${validationError.message}`);
      }
    }
    writeExclusive(failurePath, {
      task_id: task.id,
      recorded_at: recordedAt,
      duration_ms: durationMs,
      exit_status: call.status,
      signal: call.signal,
      error: error.message,
      evidence_retained: ['request.json', 'events.jsonl', 'stderr.log', 'call-audit.json', 'system-audit.json', 'params-audit.json', 'session-export.json'].filter((name) => fs.existsSync(path.join(taskDir, name))),
    });
    return { task_id: task.id, status: 'failed', error: error.message };
  }
}

function run(planPath, configPath, runDir) {
  const context = initialize(planPath, configPath, runDir);
  const statuses = context.tasks.map((task) => runTask(context, task));
  writeAtomic(path.join(runDir, 'status.json'), { purpose: context.config.purpose, plan_hash: context.plan.plan_hash, statuses });
  return statuses;
}

function importResults(planPath, runDir, outputPath) {
  const plan = read(planPath);
  checkPlan(plan);
  const config = read(path.join(runDir, 'runner-config.json'));
  checkConfig(config, plan);
  const tasks = tasksFor(plan, config);
  const pluginPath = path.join(runDir, 'opencode-rewrite-eval-plugin.mjs');
  assert.equal(fs.readFileSync(pluginPath, 'utf8'), pluginSource(), 'run plugin differs from the pinned adapter source');
  const resolvedConfig = read(path.join(runDir, 'resolved-config.json'));
  checkResolvedConfig(resolvedConfig, pluginPath);
  const agent = read(path.join(runDir, 'resolved-agent.json'));
  checkResolvedAgent(agent);
  const manifest = read(path.join(runDir, 'manifest.json'));
  assert.deepEqual(manifest, buildManifest(plan, config, tasks, pluginPath, resolvedConfig, agent), 'run manifest is not derived from the retained plan, config and environment audits');
  const results = tasks.map((task) => validateTaskEvidence(
    plan,
    config,
    task,
    path.join(runDir, 'tasks', safeId(task.id)),
  ));
  checkResults(plan, results, { git: false });
  writeExclusiveAtomic(outputPath, results);
  return results;
}

const USAGE = 'Usage: rewrite-eval-opencode.js run PLAN CONFIG RUN_DIR | import PLAN RUN_DIR RESULTS';

function main(argv) {
  const [operation, ...args] = argv;
  if (operation === 'run' && args.length === 3) {
    const statuses = run(...args);
    const failed = statuses.filter((item) => item.status === 'failed');
    console.log(JSON.stringify({ tasks: statuses.length, complete: statuses.length - failed.length, failed: failed.length }));
    if (failed.length) process.exitCode = 1;
  } else if (operation === 'import' && args.length === 3) {
    const results = importResults(...args);
    console.log(JSON.stringify({ imported: results.length }));
  } else {
    throw new Error(USAGE);
  }
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

module.exports = {
  AGENT, TRANSPORT, checkConfig, effectiveParams, importResults, openCodeConfig,
  parseEvents, pluginSource, run, safeId, writeExclusiveAtomic,
};
