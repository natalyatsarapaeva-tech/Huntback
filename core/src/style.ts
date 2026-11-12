// Стиль документа: ИИ-измы, тире, повторы. Детерминированно, без модели.
//
// Эти детекторы делают две работы. Во-первых, это обычные проверки рядом с
// текстом (warn/info). Во-вторых — и это важнее — их находки передаются
// агенту-проверяющему и писателю как факты, а не мнения: «слово delve в
// буллите 3» модель-проверяющая может пропустить, код — нет.

import type { CheckResult } from './types.ts';
import { normalize, words, extractNumbers, sentences, findPhrase } from './text.ts';

/**
 * Слова и обороты, по которым читатель узнаёт текст, написанный моделью.
 * Список не про «плохой английский», а про узнаваемость: каждое из них само
 * по себе допустимо, но в резюме руководителя почти не встречается у людей.
 */
export const AI_ISMS: Record<string, string[]> = {
  en: [
    'delve', 'spearheaded', 'spearheading', 'testament to', 'seamless', 'seamlessly', 'tapestry',
    'pivotal', 'ever-evolving', 'fast-paced landscape', 'in today\'s', 'navigate the complexities',
    'realm', 'holistic', 'cutting-edge', 'game-changer', 'game changer', 'unlock the potential',
    'elevate', 'empower', 'foster a culture', 'harness the power', 'meticulous',
    'transformative', 'it is worth noting', 'it\'s worth noting', 'commitment to excellence',
    'plays a crucial role', 'a crucial role', 'underscore', 'underscores', 'showcase', 'showcasing',
    'thrive', 'thriving', 'bespoke', 'furthermore', 'moreover', 'robust track record',
    'dynamic environment', 'passion for', 'i am confident that', 'i am eager to',
    'align perfectly', 'aligns perfectly', 'unique blend', 'wealth of experience', 'invaluable',
    'impactful', 'synergize', 'paradigm',
  ],
  ru: [
    'является ключевым', 'играет важную роль', 'в современном мире', 'стоит отметить',
    'уникальное сочетание', 'богатый опыт', 'бесценный', 'трансформационный', 'синергия',
  ],
  sv: ['banbrytande', 'sömlös', 'sömlöst', 'holistisk', 'passion för'],
};

export interface StyleHit { phrase: string; at: number }

export function findAiIsms(text: string, lang = 'en'): StyleHit[] {
  const list = AI_ISMS[lang] ?? AI_ISMS.en;
  const hits: StyleHit[] = [];
  const taken = new Set<number>();
  for (const p of list) {
    // Словоформы с порогом основы 5: «elevated» ловится как «elevate»,
    // а короткие слова сравниваются только точно.
    const at = findPhrase(text, p, 5);
    // «spearheaded» и «spearheading» — одно слово в тексте, одно замечание.
    if (at !== -1 && !taken.has(at)) { taken.add(at); hits.push({ phrase: p, at }); }
  }
  return hits;
}

/** Длинные тире на 100 слов. У людей в деловом тексте — редко больше одного. */
export function dashDensity(text: string): number {
  const n = words(text).length;
  if (!n) return 0;
  const dashes = (String(text).match(/—|–| - /g) || []).length;
  return (dashes / n) * 100;
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by', 'from', 'at', 'as',
  'is', 'was', 'were', 'be', 'that', 'this', 'it', 'its', 'into', 'over', 'per', 'across', 'than',
  'и', 'в', 'на', 'с', 'по', 'для', 'из', 'от', 'до', 'за',
]);

function contentWords(s: string): Set<string> {
  return new Set(words(s).filter(w => w.length > 2 && !STOP.has(w)).map(w => w.slice(0, 6)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export interface DuplicatePair { a: number; b: number; reason: 'wording' | 'same_number' }

/**
 * Повторы между пунктами: одно достижение, рассказанное дважды. Признаки —
 * большая доля общих слов или одно и то же «говорящее» число (не год и не
 * однозначное) в двух пунктах.
 */
export function findDuplicates(items: string[], threshold = 0.55): DuplicatePair[] {
  const out: DuplicatePair[] = [];
  const sets = items.map(contentWords);
  const nums = items.map(t => new Set(extractNumbers(t).filter(n => n.length >= 2 && !/^(19|20)\d\d$/.test(n))));
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (jaccard(sets[i], sets[j]) >= threshold) { out.push({ a: i, b: j, reason: 'wording' }); continue; }
      const shared = [...nums[i]].filter(n => nums[j].has(n));
      if (shared.length && jaccard(sets[i], sets[j]) >= 0.25) out.push({ a: i, b: j, reason: 'same_number' });
    }
  }
  return out;
}

/** Три и больше пунктов подряд с одного глагола — «Led… Led… Led…». */
function repeatedOpenings(items: string[]): string | null {
  const firsts = items.map(t => normalize(t).split(' ')[0] ?? '');
  for (let i = 0; i + 2 < firsts.length; i++) {
    if (firsts[i] && firsts[i] === firsts[i + 1] && firsts[i] === firsts[i + 2]) return firsts[i];
  }
  const counts = new Map<string, number>();
  for (const f of firsts) if (f) counts.set(f, (counts.get(f) ?? 0) + 1);
  for (const [w, c] of counts) if (c >= 4) return w;
  return null;
}

export interface StyleOptions {
  lang?: string;
  /** Пункты, между которыми ищутся повторы: буллиты резюме или предложения письма. */
  items?: string[];
  /** Что это за пункты — для текста замечания. */
  itemName?: 'bullet' | 'sentence';
  maxDashesPer100?: number;
}

/** Стилевые проверки для резюме и письма. Уровни мягкие: решает человек. */
export function checkStyle(text: string, opts: StyleOptions = {}): CheckResult[] {
  const out: CheckResult[] = [];
  const hits = findAiIsms(text, opts.lang ?? 'en');
  for (const h of hits) {
    out.push({
      rule: 'ai_isms', level: 'warn',
      message: `Reads as machine-written: “${h.phrase}”`,
      locator: { kind: 'offset', value: h.at },
    });
  }
  const density = dashDensity(text);
  const max = opts.maxDashesPer100 ?? 1.5;
  if (density > max) {
    out.push({
      rule: 'dash_density', level: 'info',
      message: `${density.toFixed(1)} dashes per 100 words — a frequent tell of generated text; use commas or full stops`,
    });
  }
  const items = opts.items ?? [];
  const name = opts.itemName ?? 'bullet';
  for (const d of findDuplicates(items)) {
    out.push({
      rule: 'duplicate', level: 'warn',
      message: d.reason === 'wording'
        ? `${cap(name)}s ${d.a + 1} and ${d.b + 1} say the same thing`
        : `${cap(name)}s ${d.a + 1} and ${d.b + 1} repeat the same number — one achievement told twice?`,
      locator: { kind: name === 'bullet' ? 'bullet' : 'paragraph', value: d.b },
    });
  }
  if (name === 'bullet') {
    const w = repeatedOpenings(items);
    if (w) {
      out.push({ rule: 'repeated_opening', level: 'info', message: `Too many bullets start with “${w}” — vary the verbs` });
    }
  }
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Предложения письма — пункты для поиска повторов. */
export function letterItems(body: string): string[] {
  return sentences(body);
}
