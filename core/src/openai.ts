// Чистые правила обращения к OpenAI, которые проверяются тестами без сети.

/**
 * Принимает ли модель `temperature`. Рассуждающие модели (семейства gpt-5.x,
 * gpt-6, o-серия) отвечают на него 400 «Unsupported parameter» — и тогда не
 * работает ни один вызов. Старые gpt-4.x параметр принимают.
 */
export function acceptsTemperature(model: string): boolean {
  return !/^(gpt-[5-9]|o\d)/i.test(model.trim());
}

export interface OpenAIErrorInfo {
  status: number;
  code: string | null;
  param: string | null;
  /** Текст OpenAI, обрезанный: в логах и на экране не место длинным телам. */
  message: string;
}

const MAX_MESSAGE = 300;

/**
 * Достаёт из тела ошибки OpenAI ровно то, что нужно для диагноза: код,
 * параметр и сообщение. Тело целиком не хранится — в нём теоретически может
 * оказаться кусок промпта, то есть резюме (§14 «Логи»); сообщения об ошибках
 * запроса — «Unsupported parameter», «model does not exist» — его не содержат.
 */
export function parseOpenAIError(status: number, body: string): OpenAIErrorInfo {
  let err: { message?: unknown; code?: unknown; type?: unknown; param?: unknown } = {};
  try {
    const parsed = JSON.parse(body) as { error?: typeof err };
    if (parsed && typeof parsed.error === 'object' && parsed.error) err = parsed.error;
  } catch { /* не JSON — останется только статус */ }
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const message = str(err.message) ?? '';
  return {
    status,
    code: str(err.code) ?? str(err.type),
    param: str(err.param),
    message: message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE)}…` : message,
  };
}

/** Одна строка для usage_log и для экрана: «400 unsupported_parameter (temperature): …». */
export function describeOpenAIError(e: OpenAIErrorInfo): string {
  const head = [String(e.status), e.code, e.param ? `(${e.param})` : null].filter(Boolean).join(' ');
  return e.message ? `${head}: ${e.message}` : head;
}
