export const RRF_K = 60;

export interface FusedItem {
  id: string;
  score: number;
}

/**
 * Оценка BM25 — неограниченное положительное число, косинусная близость лежит
 * в [-1, 1]; складывать их нельзя, шкалы несопоставимы. RRF работает с рангами,
 * а не с оценками, и потому от шкал не зависит: score(d) = Σ 1 / (k + rank_i(d)),
 * ранги с единицы.
 *
 * `firstSeen` нужен, чтобы сортировка была устойчивой: при равных оценках
 * порядок должен быть детерминированным, иначе выдача плавает между
 * одинаковыми запросами.
 */
export function reciprocalRankFusion(rankings: string[][], k: number = RRF_K): FusedItem[] {
  const scores = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  let order = 0;

  for (const ranking of rankings) {
    const seen = new Set<string>();
    for (let rank = 0; rank < ranking.length; rank++) {
      const id = ranking[rank];
      if (seen.has(id)) {
        continue;
      }
      seen.add(id);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
      if (!firstSeen.has(id)) {
        firstSeen.set(id, order++);
      }
    }
  }

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || (firstSeen.get(a.id) ?? 0) - (firstSeen.get(b.id) ?? 0));
}
