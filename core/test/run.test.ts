import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RUN_STAGES, estimateRunSeconds, runProgress, humanDuration, describeAngleOutcomes,
} from '../src/index.ts';

test('веса этапов складываются в единицу', () => {
  const sum = RUN_STAGES.reduce((a, s) => a + s.weight, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, String(sum));
});

test('оценка растёт с числом направлений и падает с параллелизмом', () => {
  const one = estimateRunSeconds(1, 3);
  const six = estimateRunSeconds(6, 3);
  assert.ok(six > one, `${six} должно быть больше ${one}`);
  assert.ok(estimateRunSeconds(6, 6) < estimateRunSeconds(6, 2), 'больше параллелизма — быстрее');
  // Узкий периметр — около минуты, широкий — минуты.
  assert.ok(one >= 45 && one <= 75, `${one}`);
  assert.ok(six >= 100, `${six}`);
});

test('оценка не делит на ноль и не уходит в минус', () => {
  assert.ok(estimateRunSeconds(0, 0) > 0);
  assert.ok(estimateRunSeconds(-5, -5) > 0);
});

test('прогресс двигают завершённые направления, а не таймер', () => {
  const early = runProgress({ stage: 'search', anglesDone: 0, anglesTotal: 4, elapsedSec: 5, estimateSec: 200 });
  const half = runProgress({ stage: 'search', anglesDone: 2, anglesTotal: 4, elapsedSec: 5, estimateSec: 200 });
  assert.ok(half.fraction > early.fraction, 'два направления из четырёх дальше нуля');
  assert.equal(half.detail, '2 из 4 направлений');
  assert.equal(early.detail, '0 из 4 направлений');
});

test('таймер не даёт полосе замереть, но не обгоняет реальный факт', () => {
  // Одно направление из четырёх сделано, времени прошло много: полоса ползёт,
  // но не может дойти до отметки «два из четырёх».
  const p = runProgress({ stage: 'search', anglesDone: 1, anglesTotal: 4, elapsedSec: 190, estimateSec: 200 });
  const twoDone = runProgress({ stage: 'search', anglesDone: 2, anglesTotal: 4, elapsedSec: 190, estimateSec: 200 });
  assert.ok(p.fraction < twoDone.fraction, 'ползком нельзя обогнать факт');
  const frozen = runProgress({ stage: 'search', anglesDone: 1, anglesTotal: 4, elapsedSec: 10, estimateSec: 200 });
  assert.ok(p.fraction > frozen.fraction, 'со временем полоса всё же движется');
});

test('полоса никогда не показывает 100% до фактического конца', () => {
  const almost = runProgress({ stage: 'save', anglesDone: 6, anglesTotal: 6, elapsedSec: 9999, estimateSec: 100 });
  assert.ok(almost.fraction < 1, String(almost.fraction));
  assert.ok(almost.percent <= 99);
  const done = runProgress({ stage: 'done', elapsedSec: 120, estimateSec: 100 });
  assert.equal(done.percent, 100);
  assert.equal(done.remainingSec, 0);
});

test('прогресс монотонен по этапам', () => {
  const seq = (['plan', 'search', 'dedup', 'save'] as const).map(stage =>
    runProgress({ stage, anglesDone: 0, anglesTotal: 4, elapsedSec: 0, estimateSec: 200 }).fraction);
  for (let i = 1; i < seq.length; i++) {
    assert.ok(seq[i] >= seq[i - 1], `этап ${i} не должен быть позади предыдущего`);
  }
});

test('остаток времени уменьшается по мере прогресса', () => {
  const a = runProgress({ stage: 'search', anglesDone: 1, anglesTotal: 4, elapsedSec: 50, estimateSec: 200 });
  const b = runProgress({ stage: 'search', anglesDone: 3, anglesTotal: 4, elapsedSec: 150, estimateSec: 200 });
  assert.ok(b.remainingSec < a.remainingSec);
  assert.ok(a.remainingSec >= 0 && b.remainingSec >= 0);
});

test('humanDuration говорит по-человечески', () => {
  assert.match(humanDuration(20), /секунд/);
  assert.equal(humanDuration(60), 'около минуты');
  assert.match(humanDuration(150), /около 3 минут|около 2 минут/);
  assert.match(humanDuration(0), /секунд/);
});

test('итог направлений: ошибка, пустой ответ и отброшенное названы по отдельности', () => {
  const notes = describeAngleOutcomes([
    { angle: 'COO в логистике', returned: 0, kept: 0, error: 'Ответ модели обрезан' },
    { angle: 'VP Operations', returned: 0, kept: 0 },
    { angle: 'Head of Supply Chain', returned: 4, kept: 1 },
    { angle: 'Директор по производству', returned: 3, kept: 3 },
  ]);
  assert.match(notes[0], /«COO в логистике»: ошибка — Ответ модели обрезан/);
  assert.match(notes[1], /не нашла ни одного/);
  assert.match(notes[2], /вернула 4, отброшено 3/);
  assert.equal(notes[3], '«Директор по производству»: найдено 3');
});
