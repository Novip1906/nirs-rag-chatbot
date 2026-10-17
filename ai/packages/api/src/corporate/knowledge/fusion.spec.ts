import { RRF_K, reciprocalRankFusion } from './fusion';

describe('reciprocalRankFusion', () => {
  it('документ, найденный обеими ветками, обходит найденного одной', () => {
    const fused = reciprocalRankFusion([['a', 'b'], ['b', 'c']]);
    expect(fused[0].id).toBe('b');
  });

  it('порядок внутри ветки сохраняется при равном числе вхождений', () => {
    const fused = reciprocalRankFusion([['a', 'b']]);
    expect(fused.map((f) => f.id)).toEqual(['a', 'b']);
  });

  it('документ из единственной непустой ветки попадает в выдачу', () => {
    expect(reciprocalRankFusion([[], ['x']]).map((f) => f.id)).toEqual(['x']);
  });

  it('пустой вход даёт пустой выход', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
    expect(reciprocalRankFusion([[], []])).toEqual([]);
  });

  it('дубли внутри одной ветки учитываются один раз, по лучшему рангу', () => {
    const fused = reciprocalRankFusion([['a', 'a', 'b']]);
    expect(fused.map((f) => f.id)).toEqual(['a', 'b']);
    expect(fused[0].score).toBeCloseTo(1 / (RRF_K + 1));
  });

  it('k = 60 по умолчанию', () => {
    expect(reciprocalRankFusion([['a']])[0].score).toBeCloseTo(1 / 61);
  });
});
