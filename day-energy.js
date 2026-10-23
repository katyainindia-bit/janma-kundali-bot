/**
 * «Энергия дня» — связный текст на день, собранный ТОЛЬКО из расчёта:
 * те же отрезки (от восхода до восхода), та же оценка (хорошо / средне /
 * неблагоприятно), что и в «Днях». Вручную ничего не придумывается, поэтому
 * текст не может спорить с цветом дня.
 *
 * Три источника:
 *  1) дом от лагны, по которому идёт Луна, — тема дня;
 *  2) положение Луны относительно натальной Луны (Чандра-бала) и дружественность
 *     накшатры дня (Тара-бала) — причина оценки отрезка;
 *  3) оценка отрезка (tone) — что можно и чего не стоит делать.
 */

const SIGNS = ['Овен', 'Телец', 'Близнецы', 'Рак', 'Лев', 'Дева', 'Весы', 'Скорпион', 'Стрелец', 'Козерог', 'Водолей', 'Рыбы'];

// Тема дня по дому от лагны (утверждено формулировками пользователя)
const HOUSE_THEMES = {
  1: 'самочувствие, личные решения, всё, что касается тебя лично',
  2: 'деньги, семья, питание, речь',
  3: 'инициатива, переписка, короткие поездки, практические навыки',
  4: 'дом, мать, покой, недвижимость, внутреннее состояние',
  5: 'творчество, дети, учёба, практика, романтические отношения',
  6: 'работа, здоровье, распорядок, долги, текущие дела',
  7: 'партнёры, клиенты, переговоры, договоры',
  8: 'кризисы, скрытое, чужие деньги, глубокая внутренняя работа; время осторожности',
  9: 'учителя, учёба, дальние поездки, дхарма, удача',
  10: 'карьера, положение, публичные действия, начальство',
  11: 'доход, друзья, сообщества, исполнение планов',
  12: 'уединение, расходы, сон, отдых, духовная практика',
};

// Короткая тема дома — для совета «что делать»
const HOUSE_SHORT = {
  1: 'личные решения', 2: 'деньги и семья', 3: 'переписка, поездки, навыки', 4: 'дом и покой',
  5: 'творчество, дети, учёба', 6: 'работа и здоровье', 7: 'партнёры и договоры', 8: 'кризисы и чужие деньги',
  9: 'учёба, учителя, дальние поездки', 10: 'карьера и публичные действия', 11: 'доходы и друзья', 12: 'уединение и расходы',
};

const TONE_WORD = { good: 'благоприятно', moderate: 'нейтрально', bad: 'неблагоприятно' };
// Совет связан с темой дома: «<тема>: <что делать>». 8-й и 12-й дома — особые случаи.
function adviceFor(tone, house, laterBetter) {
  const topic = cap(HOUSE_SHORT[house] || 'дела дня');
  if (tone === 'bad') return `${topic}: не принимай серьёзных решений и не подписывай документы.`;
  if (tone === 'moderate') {
    return `${topic}: вести в обычном режиме, без больших решений${laterBetter ? ', важное лучше оставить на более сильные часы' : ''}.`;
  }
  if (house === 8) return `${topic}: хорошо для внутренней работы и разбора, рискованное лучше не начинать.`;
  if (house === 12) return `${topic}: хорошо для отдыха и практики, крупные траты лучше отложить.`;
  return `${topic}: хорошее время для важных дел и переговоров.`;
}
const TITLE_BY_TONE = { good: 'поддерживающая', moderate: 'ровная', bad: 'требует осторожности' };

function taraIsGood(tara) {
  return !!tara && (tara.quality === 'благоприятно' || tara.quality === 'наиболее благоприятно');
}

function houseFromLagna(moonSignName, lagnaSignIdx) {
  const idx = SIGNS.indexOf(moonSignName);
  if (idx < 0 || lagnaSignIdx == null) return null;
  return ((idx - lagnaSignIdx + 12) % 12) + 1;
}

function reasonText(sg) {
  const parts = [];
  const hasC = !!sg.chandra, hasT = !!sg.tara;
  const cGood = hasC && sg.chandra.good;
  const tGood = hasT && taraIsGood(sg.tara);
  if (hasC) {
    parts.push(cGood
      ? 'положение Луны относительно твоей натальной хорошее'
      : `положение Луны относительно твоей натальной неблагоприятное (${sg.chandra.house}-й дом от неё)`);
  }
  if (hasT) {
    const t = tGood ? 'накшатра дня для тебя дружественная' : 'накшатра дня для тебя неблагоприятная';
    parts.push(hasC && cGood !== tGood ? 'но ' + t : t);
  }
  return parts.join(', ');
}

function groupKey(sg) {
  const cGood = sg.chandra ? sg.chandra.good : '-';
  const tGood = sg.tara ? taraIsGood(sg.tara) : '-';
  return [sg.tone, cGood, tGood, cGood === false ? sg.chandra.house : ''].join('|');
}

/**
 * segments — отрезки дня из computeDayNakshatraSegments (с tone, chandra, tara,
 * moonSign, from/to/fromDate/toDate); lagnaSignIdx — индекс знака лагны (0..11).
 * Возвращает { title, text } или null, если личных данных нет.
 */
function buildDayEnergy(segments, lagnaSignIdx, moonSpan) {
  if (!segments || !segments.length || !segments[0].tone) return null;
  const startDate = segments[0].fromDate;
  const clock = (t, date) => (date && date !== startDate ? `${t} следующего дня` : t);

  // тема: дом Луны от лагны; если в течение дня Луна меняет дом, говорим об этом
  const houseAt = segments.map((sg) => houseFromLagna(sg.moonSign, lagnaSignIdx));
  const sentences = [];
  const h0 = houseAt[0];
  if (h0) sentences.push(`Луна идёт по твоему ${h0}-му дому: ${HOUSE_THEMES[h0]}.`);
  if (h0 && moonSpan && moonSpan.enter) {
    const rel = (stamp) => {
      const day = (s) => Date.UTC(+s.slice(6, 10), +s.slice(3, 5) - 1, +s.slice(0, 2));
      const diff = Math.round((day(stamp.slice(0, 10)) - day(startDate)) / 86400000);
      const t = stamp.slice(11, 16);
      if (diff === 0) return `сегодня в ${t}`;
      if (diff === -1) return `вчера в ${t}`;
      if (diff === -2) return `позавчера в ${t}`;
      if (diff === 1) return `завтра в ${t}`;
      if (diff === 2) return `послезавтра в ${t}`;
      return `${stamp.slice(0, 5)} в ${t}`;
    };
    const exitsToday = moonSpan.exit && segments.some((sg, i) => i > 0 && houseAt[i] !== houseAt[i - 1]);
    sentences.push(exitsToday
      ? `Луна вошла в этот дом ${rel(moonSpan.enter)}.`
      : `Луна вошла в этот дом ${rel(moonSpan.enter)} и пробудет в нём до ${moonSpan.exit ? rel(moonSpan.exit) : 'конца суток'}.`);
  }
  for (let i = 1; i < segments.length; i++) {
    if (houseAt[i] && houseAt[i] !== houseAt[i - 1]) {
      sentences.push(`С ${clock(segments[i].from, segments[i].fromDate)} Луна переходит в ${houseAt[i]}-й дом: ${HOUSE_THEMES[houseAt[i]]}.`);
    }
  }

  // отрезки с одинаковой оценкой и причиной склеиваем
  const groups = [];
  for (const sg of segments) {
    const k = groupKey(sg);
    const last = groups[groups.length - 1];
    if (last && last.key === k) {
      last.to = sg.to; last.toDate = sg.toDate; last.share += sg.share;
    } else {
      groups.push({ key: k, tone: sg.tone, sg, from: sg.from, fromDate: sg.fromDate, to: sg.to, toDate: sg.toDate, share: sg.share });
    }
  }

  const hasGoodLater = (idx) => groups.slice(idx + 1).some((g) => g.tone === 'good');
  if (groups.length === 1) {
    const g = groups[0];
    sentences.push(`Весь день ${TONE_WORD[g.tone]}: ${reasonText(g.sg)}. ${adviceFor(g.tone, houseFromLagna(g.sg.moonSign, lagnaSignIdx))}`);
  } else {
    groups.forEach((g, i) => {
      let when;
      if (i === 0) when = `До ${clock(g.to, g.toDate)}`;
      else if (i === groups.length - 1) when = `С ${clock(g.from, g.fromDate)} до следующего восхода`;
      else when = `С ${clock(g.from, g.fromDate)} до ${clock(g.to, g.toDate)}`;
      const advice = adviceFor(g.tone, houseFromLagna(g.sg.moonSign, lagnaSignIdx), g.tone === 'moderate' && hasGoodLater(i));
      sentences.push(`${when} ${TONE_WORD[g.tone]}: ${reasonText(g.sg)}. ${advice}`);
    });
  }

  // заголовок по преобладающей оценке (по доле времени)
  const share = { good: 0, moderate: 0, bad: 0 };
  groups.forEach((g) => { share[g.tone] += g.share; });
  const dominant = Object.keys(share).sort((a, b) => share[b] - share[a])[0];
  const total = share.good + share.moderate + share.bad;
  const word = share[dominant] / total >= 0.6 ? TITLE_BY_TONE[dominant] : 'меняется в течение дня';
  return { title: `Энергия дня: ${word}`, text: sentences.join(' ') };
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

module.exports = { buildDayEnergy, HOUSE_THEMES, HOUSE_SHORT, houseFromLagna, reasonText, adviceFor, groupKey, TONE_WORD, cap };
