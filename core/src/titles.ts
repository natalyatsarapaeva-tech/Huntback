// Названия ролей и LinkedIn — без модели.
//
// Зачем это в ядре. Веб-поиск находит вакансию, только если запрос совпал с
// тем, как её назвал работодатель. «VP Operations» в периметре и «Head of
// Operations» в объявлении — одна роль, но разные запросы; а в Швеции та же
// роль часто публикуется как «driftchef». Раньше варианты придумывала модель
// внутри поиска — каждый раз по-разному и обычно два-три. Теперь словарь
// синонимов даёт полный и одинаковый от прогона к прогону список, а модель
// получает его готовым.
//
// LinkedIn здесь же: канонический адрес вакансии (для дедупа и для ссылки,
// которая открывается без логина) и готовые ссылки поиска с фильтрами, которые
// пользователь открывает сам — без парсинга LinkedIn.

import { normalize } from './text.ts';

/** Группы синонимов: одна функция руководителя — все её распространённые названия. */
interface TitleGroup {
  id: string;
  /** Слова, по которым направление периметра узнаётся как эта группа. */
  match: RegExp;
  en: string[];
  /** Названия на языке страны: ключ — код языка. */
  local: Partial<Record<LangCode, string[]>>;
}

export type LangCode = 'sv' | 'no' | 'da' | 'fi' | 'de' | 'nl' | 'fr' | 'es' | 'it' | 'pl';

const GROUPS: TitleGroup[] = [
  {
    id: 'operations',
    match: /\b(operations?|operativ|coo\b|drift|betrieb)/,
    en: ['COO', 'Chief Operating Officer', 'VP Operations', 'Head of Operations', 'Director of Operations', 'Operations Director'],
    local: {
      sv: ['driftchef', 'operativ chef', 'verksamhetschef'],
      no: ['driftssjef', 'operasjonsdirektør'],
      da: ['driftschef', 'operationsdirektør'],
      fi: ['operatiivinen johtaja'],
      de: ['Leiter Operations', 'Bereichsleiter Operations', 'Betriebsleiter'],
      nl: ['operationeel directeur', 'hoofd operations'],
      fr: ['directeur des opérations'],
      es: ['director de operaciones'],
      it: ['direttore operativo'],
      pl: ['dyrektor operacyjny'],
    },
  },
  {
    id: 'supply_chain',
    match: /supply chain|\bs.?op\b|forsyning|toimitusketju|lieferkette/,
    en: ['Head of Supply Chain', 'Supply Chain Director', 'VP Supply Chain', 'Director of Supply Chain', 'Chief Supply Chain Officer'],
    local: {
      sv: ['supply chain-chef', 'chef supply chain'],
      no: ['supply chain-direktør'],
      da: ['supply chain-direktør'],
      fi: ['toimitusketjujohtaja'],
      de: ['Leiter Supply Chain', 'Head of Supply Chain Management'],
      nl: ['supply chain directeur'],
      fr: ['directeur supply chain'],
      es: ['director de cadena de suministro'],
      it: ['direttore supply chain'],
      pl: ['dyrektor łańcucha dostaw'],
    },
  },
  {
    id: 'logistics',
    match: /logisti|fulfil|warehouse|lager|distribution/,
    en: ['Head of Logistics', 'Logistics Director', 'Director of Logistics', 'VP Logistics', 'Head of Fulfilment', 'Director of Fulfilment'],
    local: {
      sv: ['logistikchef', 'lagerchef'],
      no: ['logistikksjef', 'lagersjef'],
      da: ['logistikchef', 'lagerchef'],
      fi: ['logistiikkajohtaja', 'logistiikkapäällikkö'],
      de: ['Leiter Logistik', 'Logistikleiter'],
      nl: ['hoofd logistiek', 'logistiek directeur'],
      fr: ['directeur logistique'],
      es: ['director de logística'],
      it: ['direttore logistica'],
      pl: ['dyrektor logistyki'],
    },
  },
  {
    id: 'procurement',
    match: /procure|purchas|sourcing|inköp|einkauf|innkjøp|indkøb|hankinta/,
    en: ['Head of Procurement', 'Procurement Director', 'Chief Procurement Officer', 'Head of Purchasing', 'Director of Sourcing'],
    local: {
      sv: ['inköpschef'], no: ['innkjøpssjef'], da: ['indkøbschef'], fi: ['hankintajohtaja'],
      de: ['Leiter Einkauf', 'Einkaufsleiter'], nl: ['inkoopdirecteur', 'hoofd inkoop'],
      fr: ['directeur des achats'], es: ['director de compras'], it: ['direttore acquisti'], pl: ['dyrektor zakupów'],
    },
  },
  {
    id: 'product',
    match: /\bproduct|\bcpo\b|produkt/,
    en: ['Chief Product Officer', 'VP Product', 'Head of Product', 'Director of Product', 'Product Director'],
    local: {
      sv: ['produktchef'], no: ['produktsjef'], da: ['produktchef'], fi: ['tuotejohtaja'],
      de: ['Leiter Produktmanagement', 'Head of Product'], nl: ['hoofd product'],
      fr: ['directeur produit'], es: ['director de producto'], it: ['direttore prodotto'], pl: ['dyrektor produktu'],
    },
  },
  {
    id: 'engineering',
    match: /engineer|\bcto\b|technolog|tech lead|it director|\bit\b|utveckling|entwicklung/,
    en: ['CTO', 'Chief Technology Officer', 'VP Engineering', 'Head of Engineering', 'Engineering Director', 'IT Director'],
    local: {
      sv: ['utvecklingschef', 'teknikchef', 'IT-chef'], no: ['teknologidirektør', 'IT-sjef'], da: ['teknologidirektør', 'IT-chef'],
      fi: ['teknologiajohtaja', 'IT-johtaja'], de: ['Leiter Entwicklung', 'Leiter IT', 'Technischer Leiter'],
      nl: ['technisch directeur', 'IT-directeur'], fr: ['directeur technique', 'DSI'],
      es: ['director de tecnología'], it: ['direttore tecnico'], pl: ['dyrektor techniczny', 'dyrektor IT'],
    },
  },
  {
    id: 'finance',
    match: /financ|\bcfo\b|controller|ekonomi|finanz|økonomi|talous/,
    en: ['CFO', 'Chief Financial Officer', 'Finance Director', 'Head of Finance', 'VP Finance', 'Financial Controller'],
    local: {
      sv: ['ekonomichef', 'finanschef'], no: ['økonomisjef', 'finansdirektør'], da: ['økonomichef', 'finansdirektør'],
      fi: ['talousjohtaja'], de: ['Leiter Finanzen', 'Kaufmännischer Leiter'], nl: ['financieel directeur'],
      fr: ['directeur administratif et financier', 'DAF'], es: ['director financiero'], it: ['direttore finanziario'], pl: ['dyrektor finansowy'],
    },
  },
  {
    id: 'people',
    match: /\bhr\b|people|human resources|chro|talent|personal/,
    en: ['CHRO', 'Chief People Officer', 'HR Director', 'Head of HR', 'Head of People', 'VP People'],
    local: {
      sv: ['HR-chef', 'personalchef'], no: ['HR-sjef', 'personalsjef'], da: ['HR-chef', 'personalechef'],
      fi: ['henkilöstöjohtaja'], de: ['Personalleiter', 'Leiter HR'], nl: ['HR-directeur'],
      fr: ['DRH', 'directeur des ressources humaines'], es: ['director de recursos humanos'], it: ['direttore risorse umane'], pl: ['dyrektor HR'],
    },
  },
  {
    id: 'sales',
    match: /sales|revenue|commercial|\bcro\b|försälj|vertrieb|salg|myynti/,
    en: ['Chief Revenue Officer', 'VP Sales', 'Head of Sales', 'Sales Director', 'Commercial Director'],
    local: {
      sv: ['försäljningschef', 'säljchef'], no: ['salgssjef', 'salgsdirektør'], da: ['salgschef', 'salgsdirektør'],
      fi: ['myyntijohtaja'], de: ['Vertriebsleiter', 'Leiter Vertrieb'], nl: ['commercieel directeur'],
      fr: ['directeur commercial'], es: ['director comercial'], it: ['direttore commerciale'], pl: ['dyrektor sprzedaży'],
    },
  },
  {
    id: 'marketing',
    match: /marketing|\bcmo\b|brand|marknad|marked/,
    en: ['CMO', 'Chief Marketing Officer', 'VP Marketing', 'Head of Marketing', 'Marketing Director'],
    local: {
      sv: ['marknadschef'], no: ['markedssjef', 'markedsdirektør'], da: ['marketingchef'], fi: ['markkinointijohtaja'],
      de: ['Marketingleiter', 'Leiter Marketing'], nl: ['marketingdirecteur'], fr: ['directeur marketing'],
      es: ['director de marketing'], it: ['direttore marketing'], pl: ['dyrektor marketingu'],
    },
  },
  {
    id: 'customer',
    match: /customer|client|service delivery|kundtjänst|kundeservice/,
    en: ['Head of Customer Service', 'Customer Service Director', 'VP Customer Success', 'Head of Customer Operations', 'Director of Customer Experience'],
    local: {
      sv: ['kundtjänstchef', 'kundservicechef'], no: ['kundeservicesjef'], da: ['kundeservicechef'], fi: ['asiakaspalvelujohtaja'],
      de: ['Leiter Kundenservice'], nl: ['hoofd klantenservice'], fr: ['directeur service client'],
      es: ['director de atención al cliente'], it: ['direttore customer service'], pl: ['dyrektor obsługi klienta'],
    },
  },
  {
    id: 'data',
    match: /\bdata\b|analytics|\bbi\b|business intelligence/,
    en: ['Chief Data Officer', 'Head of Data', 'Director of Data', 'Head of Analytics', 'Director of Analytics'],
    local: {
      sv: ['chef för data och analys'], de: ['Leiter Data', 'Leiter Business Intelligence'],
      fr: ['directeur data'], nl: ['hoofd data'],
    },
  },
  {
    id: 'transformation',
    match: /transformation|change|pmo|programme|program director|portfolio/,
    en: ['Transformation Director', 'Head of Transformation', 'Programme Director', 'Head of PMO', 'Chief Transformation Officer'],
    local: {
      sv: ['förändringsledare', 'programchef'], de: ['Leiter Transformation', 'Programmleiter'],
      fr: ['directeur de la transformation'], nl: ['transformatiedirecteur'],
    },
  },
  {
    id: 'general',
    match: /\bceo\b|managing director|general manager|country manager|\bvd\b|geschäftsführ|daglig leder/,
    en: ['CEO', 'Managing Director', 'General Manager', 'Country Manager'],
    local: {
      sv: ['VD', 'platschef'], no: ['daglig leder', 'administrerende direktør'], da: ['administrerende direktør'],
      fi: ['toimitusjohtaja'], de: ['Geschäftsführer'], nl: ['algemeen directeur'],
      fr: ['directeur général'], es: ['director general'], it: ['amministratore delegato'], pl: ['dyrektor generalny', 'prezes zarządu'],
    },
  },
];

// ── География ───────────────────────────────────────────────────────────────
export interface GeoPlace {
  /** Как страна называется в запросе и в поле location LinkedIn. */
  name: string;
  lang: LangCode | null;
}

const COUNTRIES: { re: RegExp; name: string; lang: LangCode | null }[] = [
  { re: /sweden|sverige|швец/, name: 'Sweden', lang: 'sv' },
  { re: /norway|norge|норвег/, name: 'Norway', lang: 'no' },
  { re: /denmark|danmark|дан/, name: 'Denmark', lang: 'da' },
  { re: /finland|suomi|финл/, name: 'Finland', lang: 'fi' },
  { re: /germany|deutschland|герман/, name: 'Germany', lang: 'de' },
  { re: /austria|österreich|австр/, name: 'Austria', lang: 'de' },
  { re: /switzerland|schweiz|швейцар/, name: 'Switzerland', lang: 'de' },
  { re: /netherlands|holland|nederland|нидерл|голланд/, name: 'Netherlands', lang: 'nl' },
  { re: /belgium|belgi|бельг/, name: 'Belgium', lang: 'nl' },
  { re: /france|франц/, name: 'France', lang: 'fr' },
  { re: /spain|españa|испан/, name: 'Spain', lang: 'es' },
  { re: /italy|italia|итал/, name: 'Italy', lang: 'it' },
  { re: /poland|polska|польш/, name: 'Poland', lang: 'pl' },
  { re: /united kingdom|\buk\b|britain|england|великобр|англи/, name: 'United Kingdom', lang: null },
  { re: /ireland|ирланд/, name: 'Ireland', lang: null },
  { re: /estonia|эстон/, name: 'Estonia', lang: null },
  { re: /latvia|латв/, name: 'Latvia', lang: null },
  { re: /lithuania|литв/, name: 'Lithuania', lang: null },
  { re: /iceland|исланд/, name: 'Iceland', lang: null },
  { re: /portugal|португ/, name: 'Portugal', lang: null },
];

/**
 * Страны из свободной строки «Sweden, Germany; remote EU». Город или регион без
 * страны («Stockholm», «EU») остаётся как есть — LinkedIn понимает и их.
 */
export function parseGeo(geo: string): GeoPlace[] {
  const parts = String(geo || '').split(/[,;\n/]+/).map(s => s.trim()).filter(Boolean);
  const out: GeoPlace[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const n = normalize(p);
    const hit = COUNTRIES.find(c => c.re.test(n));
    const place = hit ? { name: hit.name, lang: hit.lang } : { name: p, lang: null };
    if (seen.has(place.name.toLowerCase())) continue;
    seen.add(place.name.toLowerCase());
    out.push(place);
  }
  return out;
}

// ── Варианты названий ───────────────────────────────────────────────────────
export interface TitleVariants {
  /** Направление периметра, как его написал пользователь. */
  direction: string;
  group: string | null;
  /** Английские варианты; первым — формулировка пользователя. */
  en: string[];
  /** Варианты на языках стран из географии. */
  local: { lang: LangCode; country: string; titles: string[] }[];
}

const uniq = (xs: string[]) => {
  const seen = new Set<string>();
  return xs.filter(x => {
    const k = normalize(x);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** Группа направления: по ключевым словам, затем — по точному совпадению с синонимом. */
function groupFor(direction: string): TitleGroup | null {
  const n = normalize(direction);
  return GROUPS.find(g => g.match.test(n))
    ?? GROUPS.find(g => g.en.some(t => ` ${n} `.includes(` ${normalize(t)} `))) ?? null;
}

export function titleVariants(direction: string, geo: string, max = 6): TitleVariants {
  const group = groupFor(direction);
  const places = parseGeo(geo);
  const en = uniq([direction.trim(), ...(group?.en ?? [])]).slice(0, max);
  const local: TitleVariants['local'] = [];
  for (const p of places) {
    if (!p.lang || !group?.local[p.lang]) continue;
    if (local.some(l => l.lang === p.lang)) continue;
    local.push({ lang: p.lang, country: p.name, titles: group.local[p.lang]!.slice(0, 4) });
  }
  return { direction: direction.trim(), group: group?.id ?? null, en, local };
}

/** Строка для промпта: «искать так» — английские и местные названия по странам. */
export function describeTitleVariants(v: TitleVariants): string {
  const lines = ['English titles: ' + v.en.map(t => `"${t}"`).join(', ')];
  for (const l of v.local) lines.push(`${l.country} (${l.lang}): ` + l.titles.map(t => `"${t}"`).join(', '));
  return lines.join('\n');
}

// ── LinkedIn ────────────────────────────────────────────────────────────────

/** Хост LinkedIn, включая локальные поддомены se.linkedin.com, de.linkedin.com. */
export function isLinkedInUrl(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === 'linkedin.com' || h.endsWith('.linkedin.com') || h === 'lnkd.in';
  } catch {
    return false;
  }
}

/**
 * Id вакансии LinkedIn из любой формы адреса:
 *   /jobs/view/4123456789/ · /jobs/view/head-of-operations-at-acme-4123456789
 *   /comm/jobs/view/4123456789 · /jobs/search/?currentJobId=4123456789
 *   /jobs/collections/recommended/?currentJobId=…
 */
export function linkedinJobId(url: string): string | null {
  if (!isLinkedInUrl(url)) return null;
  let u: URL;
  try { u = new URL(url); } catch { return null; }
  const param = u.searchParams.get('currentJobId') ?? u.searchParams.get('jobId');
  if (param && /^\d{6,}$/.test(param)) return param;
  const m = u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})\/?$/i)
    ?? u.pathname.match(/\/jobs\/view\/(\d{6,})/i);
  return m ? m[1] : null;
}

/** Канонический адрес вакансии LinkedIn — открывается и без входа. */
export function canonicalLinkedInJobUrl(id: string): string {
  return `https://www.linkedin.com/jobs/view/${id}/`;
}

/**
 * Адрес источника в каноническом виде: для LinkedIn — /jobs/view/<id>/ без
 * трекинга; для остальных — без utm-меток и якоря. Ничего не угадывает: если
 * адрес не разбирается, возвращается как был.
 */
export function canonicalJobUrl(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  const id = linkedinJobId(raw);
  if (id) return canonicalLinkedInJobUrl(id);
  try {
    const u = new URL(raw);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|refid$|trk|trackingid$|src$|source$|gh_src$|lever-source)/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = '';
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * Похоже ли на страницу ОДНОЙ вакансии. Поиск, лента компании, пост и
 * главная страница — нет: по ним нельзя ни откликнуться, ни разобрать требования.
 */
export function looksLikeJobPostingUrl(url: string): boolean {
  const raw = String(url || '').trim();
  if (!raw) return false;
  if (isLinkedInUrl(raw)) return linkedinJobId(raw) !== null;
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  const path = u.pathname.replace(/\/+$/, '');
  if (!path) return false;
  if (/\/(search|jobs)$/i.test(path) && !u.search) return false;
  if (/[?&](q|query|keywords|search)=/i.test(u.search) && !/\d{4,}/.test(path)) return false;
  return true;
}

/** Ключ для дедупа по адресу: у LinkedIn — id вакансии, у остальных — канонический адрес. */
export function jobUrlKey(url: string | null | undefined): string | null {
  if (!url) return null;
  const id = linkedinJobId(url);
  if (id) return 'li:' + id;
  const c = canonicalJobUrl(url);
  return c ? 'url:' + c.toLowerCase().replace(/^https?:\/\/(www\.)?/, '') : null;
}

export interface LinkedInSearchLink {
  direction: string;
  location: string;
  label: string;
  url: string;
}

/**
 * Готовые ссылки поиска LinkedIn: направление × страна, фильтры «за последнюю
 * неделю» и уровень Mid-Senior/Director/Executive. Пользователь открывает их
 * сам в своём браузере — LinkedIn при этом не парсится.
 *
 * f_TPR=r604800 — опубликовано за 7 дней; f_E=4,5,6 — уровни должности.
 */
export function linkedinSearchLinks(perimeter: string, geo: string, opts: { days?: number; maxTitles?: number } = {}): LinkedInSearchLink[] {
  const days = opts.days ?? 7;
  const maxTitles = opts.maxTitles ?? 4;
  const directions = String(perimeter || '').split(/[;\n]/).map(s => s.trim()).filter(Boolean).slice(0, 8);
  const places = parseGeo(geo);
  const locations = places.length ? places : [{ name: '', lang: null }];
  const out: LinkedInSearchLink[] = [];
  for (const d of directions) {
    for (const p of locations) {
      const v = titleVariants(d, p.name, maxTitles);
      const local = v.local.find(l => l.country === p.name)?.titles.slice(0, 2) ?? [];
      const titles = uniq([...v.en.slice(0, maxTitles), ...local]);
      const keywords = titles.map(t => `"${t}"`).join(' OR ');
      const params = new URLSearchParams({ keywords, f_TPR: `r${days * 86400}`, f_E: '4,5,6' });
      if (p.name) params.set('location', p.name);
      out.push({
        direction: d, location: p.name,
        label: p.name ? `${d} · ${p.name}` : d,
        url: `https://www.linkedin.com/jobs/search/?${params.toString()}`,
      });
    }
  }
  return out;
}

// ── Текст вакансии LinkedIn ─────────────────────────────────────────────────

const decodeEntities = (s: string) => s
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
  .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

function htmlFragmentToText(html: string): string {
  return decodeEntities(html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|ul|ol)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface LinkedInJobPage { title: string; company: string; location: string; description: string }

/**
 * Гостевая страница вакансии LinkedIn (без входа). Описание лежит в блоке
 * `show-more-less-html__markup` или `description__text`; название и компания —
 * в og:title вида «Acme hiring Head of Operations in Stockholm, Sweden | LinkedIn».
 * Пустое описание — null: тогда честно просим вставить текст руками.
 */
export function extractLinkedInJob(html: string): LinkedInJobPage | null {
  const block = html.match(/<div[^>]+class="[^"]*show-more-less-html__markup[^"]*"[^>]*>([\s\S]*?)<\/div>\s*(?:<button|<\/section|<\/div>)/i)
    ?? html.match(/<div[^>]+class="[^"]*description__text[^"]*"[^>]*>([\s\S]*?)<\/section>/i);
  const description = block ? htmlFragmentToText(block[1]) : '';
  if (description.length < 200) return null;
  const og = decodeEntities(html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)?.[1] ?? '');
  const m = og.match(/^(.*?) hiring (.*?) in (.*?)(?: \| LinkedIn)?$/i);
  const title = decodeEntities(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '') || (m?.[2] ?? '');
  return {
    title: title.trim(),
    company: (m?.[1] ?? '').trim(),
    location: (m?.[3] ?? '').trim(),
    description,
  };
}

/**
 * Скопированный из LinkedIn текст полон интерфейса: «Easy Apply», «Save»,
 * «Show more», «12 applicants», «Meet the hiring team». Модели это не мешает
 * понять вакансию, но мешает разбору требований и раздувает вход. Убираем
 * строки, состоящие только из таких элементов. Содержательные строки не трогаем.
 */
const LINKEDIN_NOISE = [
  /^(easy apply|apply|save|saved|share|show more|show less|see more|see less|…\s*more|more|report this job|follow|message)$/i,
  /^\d+\s+(applicants?|people clicked apply)\b.*$/i,
  /^(over|fewer than)\s+\d+\s+applicants?$/i,
  /^(promoted|reposted|actively (recruiting|reviewing applicants)|be an early applicant|viewed)\b.*$/i,
  /^\d+\s+(minutes?|hours?|days?|weeks?|months?)\s+ago\b.*$/i,
  /^(meet the hiring team|about the job|about the company|people you can reach out to|set alert for similar jobs|job search faster with premium.*|try premium.*|retry premium.*)$/i,
  /^(on-site|hybrid|remote|full-time|part-time|contract|temporary|internship)(\s*[·|]\s*(on-site|hybrid|remote|full-time|part-time|contract))*$/i,
  /^(skills|matches your job preferences.*|your profile is missing.*|how you match|am i a good fit.*)$/i,
  /^\d+\s+(connections?|alumni|school alumni)\b.*$/i,
];

export function cleanJobText(text: string): string {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const kept = lines.filter(l => {
    const t = l.trim();
    if (!t) return true;
    return !LINKEDIN_NOISE.some(re => re.test(t));
  });
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Пакетная вставка: несколько вакансий одним текстом, разделённых строкой из
 * трёх и более дефисов или знаков «=». Куски короче 200 знаков — не вакансии
 * (подпись, случайный хвост) и отбрасываются.
 */
export function splitJobTexts(text: string, minLength = 200): string[] {
  return String(text || '').split(/^\s*(?:-{3,}|={3,})\s*$/m)
    .map(s => s.trim())
    .filter(s => s.length >= minLength);
}
