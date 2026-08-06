/* Caixinha · Cálculos financeiros
 * Reproduz a lógica da planilha:
 *   parte de cada família = valor / (soma das partes) * parte_da_familia   (arredondado a 2 casas)
 */
(function (global) {
  'use strict';

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  /** Avalia uma expressão aritmética simples e segura (apenas números e + - * / ( ) . ,). */
  function evalAmount(input) {
    if (typeof input === 'number') return isFinite(input) ? input : NaN;
    if (input == null) return NaN;
    let s = String(input).trim();
    if (s === '') return NaN;
    if (s[0] === '=') s = s.slice(1);
    // Vírgula decimal -> ponto (quando não usada como separador de milhar comum)
    s = s.replace(/\s+/g, '');
    // Se houver vírgula e nenhum ponto, tratar vírgula como decimal
    if (s.indexOf(',') !== -1 && s.indexOf('.') === -1) {
      s = s.replace(/,/g, '.');
    } else {
      s = s.replace(/,/g, '');
    }
    if (!/^[0-9+\-*/().]+$/.test(s)) return NaN;
    if (/[+\-*/.]{3,}/.test(s)) return NaN;
    try {
      // eslint-disable-next-line no-new-func
      const val = Function('"use strict";return (' + s + ')')();
      return typeof val === 'number' && isFinite(val) ? val : NaN;
    } catch (e) {
      return NaN;
    }
  }

  /** Partes -> valores por família para uma despesa. */
  function shares(expense) {
    const parts = expense.parts || [];
    const total = parts.reduce((a, b) => a + (Number(b) || 0), 0);
    const value = Number(expense.value) || 0;
    if (total <= 0) return parts.map(() => 0);
    return parts.map(function (p) {
      return round2((value / total) * (Number(p) || 0));
    });
  }

  /**
   * Matriz M[pagante][beneficiario] = total que "pagante" cobriu de "beneficiario".
   * Igual ao SUMIF da planilha.
   */
  function payerMatrix(families, expenses) {
    const n = families.length;
    const idx = {};
    families.forEach(function (f, i) { idx[f] = i; });
    const M = Array.from({ length: n }, function () { return new Array(n).fill(0); });
    expenses.forEach(function (e) {
      const p = idx[e.payer];
      if (p == null) return;
      const sh = shares(e);
      for (let b = 0; b < n; b++) {
        M[p][b] = round2(M[p][b] + (sh[b] || 0));
      }
    });
    return M;
  }

  /** Totais por família. */
  function totals(families, M) {
    const n = families.length;
    const paid = new Array(n).fill(0);      // total que a família pagou (linha)
    const consumed = new Array(n).fill(0);  // total que a família consumiu (coluna)
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        paid[i] = round2(paid[i] + M[i][j]);
        consumed[j] = round2(consumed[j] + M[i][j]);
      }
    }
    const net = paid.map(function (v, i) { return round2(v - consumed[i]); });
    const grand = paid.reduce(function (a, b) { return a + b; }, 0);
    return { paid: paid, consumed: consumed, net: net, grand: round2(grand) };
  }

  /**
   * Balanço par a par (como na planilha):
   * saldo entre i e j = M[j][i] - M[i][j].
   * Se > 0, i deve a j; se < 0, j deve a i.
   */
  function pairwiseBalances(families, M) {
    const n = families.length;
    const out = [];
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const diff = round2(M[j][i] - M[i][j]);
        let from = null, to = null, amount = 0;
        if (diff > 0.004) { from = i; to = j; amount = diff; }
        else if (diff < -0.004) { from = j; to = i; amount = -diff; }
        out.push({
          a: i, b: j,
          from: from, to: to,
          amount: round2(amount),
          settled: from === null,
          aPaidForB: M[i][j],
          bPaidForA: M[j][i]
        });
      }
    }
    return out;
  }

  function compute(trip) {
    const families = trip.families || [];
    const expenses = trip.expenses || [];
    const M = payerMatrix(families, expenses);
    const t = totals(families, M);
    const balances = pairwiseBalances(families, M);
    return { matrix: M, totals: t, balances: balances, count: expenses.length };
  }

  global.Calc = {
    round2: round2,
    evalAmount: evalAmount,
    shares: shares,
    payerMatrix: payerMatrix,
    totals: totals,
    pairwiseBalances: pairwiseBalances,
    compute: compute
  };
})(window);
