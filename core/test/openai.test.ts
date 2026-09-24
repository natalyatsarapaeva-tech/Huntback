import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptsTemperature, parseOpenAIError, describeOpenAIError, DEFAULT_MODELS } from '../src/index.ts';

test('temperature не уходит рассуждающим моделям, включая все модели из конфига', () => {
  for (const m of ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-6-astra', 'gpt-5', 'o3', 'o4-mini']) {
    assert.equal(acceptsTemperature(m), false, m);
  }
  for (const op of ['discover', 'analyse', 'resume', 'letter', 'extract', 'audit', 'check', 'ingest', 'classify'] as const) {
    assert.equal(acceptsTemperature(DEFAULT_MODELS[op]), false, op);
  }
  assert.equal(acceptsTemperature('gpt-4.1'), true);
  assert.equal(acceptsTemperature('gpt-4o-mini'), true);
});

test('ошибка OpenAI: код, параметр и сообщение доходят до строки диагноза', () => {
  const e = parseOpenAIError(400, JSON.stringify({
    error: {
      message: "Unsupported parameter: 'temperature' is not supported with this model.",
      type: 'invalid_request_error', param: 'temperature', code: 'unsupported_parameter',
    },
  }));
  assert.equal(e.code, 'unsupported_parameter');
  assert.equal(e.param, 'temperature');
  assert.equal(describeOpenAIError(e),
    "400 unsupported_parameter (temperature): Unsupported parameter: 'temperature' is not supported with this model.");
});

test('ошибка OpenAI: без code берётся type; не-JSON и длинные тела не ломают разбор', () => {
  const e = parseOpenAIError(404, JSON.stringify({
    error: { message: 'The model `gpt-x` does not exist', type: 'invalid_request_error', param: null, code: null },
  }));
  assert.equal(describeOpenAIError(e), '404 invalid_request_error: The model `gpt-x` does not exist');

  assert.equal(describeOpenAIError(parseOpenAIError(502, '<html>bad gateway</html>')), '502');

  const long = parseOpenAIError(400, JSON.stringify({ error: { message: 'x'.repeat(5000) } }));
  assert.ok(long.message.length <= 301);
});
