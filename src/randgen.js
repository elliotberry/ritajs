import Util from './util.js';

/**
 * @class SeededRandom
 * @memberof module:rita
 */
class SeededRandom {

  // see https://github.com/bmurray7/mersenne-twister-examples/blob/master/javascript-mersenne-twister.js

  constructor() {
    this.N = 624;
    this.M = 397;
    this.MATRIX_A = 0x99_08_b0_df;
    this.UPPER_MASK = 0x80_00_00_00;
    this.LOWER_MASK = 0x7f_ff_ff_ff;
    this.mt = new Array(this.N);
    this.mti = this.N + 1;
    this.seed(new Date().getTime());
  }

  shuffle(arr) { 
    const newArray = arr.slice();
    const len = newArray.length;
    let i = len;
    while (i--) {
      const p = Math.floor(this.random(len));
      const t = newArray[i];
      newArray[i] = newArray[p];
      newArray[p] = t;
    }
    return newArray;
  }

  randomOrdering(arg) {
    if (!(Array.isArray(arg) || Util.isNum(arg))) throw Error('Expects [] or int');
    const o = Array.isArray(arg) ? arg : Array.from(Array(arg).keys());
    for (let j, x, i = o.length; i; j = Math.floor(this.random() * i),
      x = o[--i], o[i] = o[j], o[j] = x) { /* shuffle */ }
    return o;
  }

  seed(num) {
    this.mt[0] = num >>> 0;
    for (this.mti = 1; this.mti < this.N; this.mti++) {
      const s = this.mt[this.mti - 1] ^ (this.mt[this.mti - 1] >>> 30);
      this.mt[this.mti] = (((((s & 0xff_ff_00_00) >>> 16) * 1_812_433_253) << 16) +
        (s & 0x00_00_ff_ff) * 1_812_433_253) + this.mti;
      this.mt[this.mti] >>>= 0;
    }
  }

  /*
    Returns a single (selected) index from a normalised
    probability distribution (with probabilities summing to 1)
  */
  pselect(probs) {
    if (!probs || !probs.length) throw Error('arg required');
    const point = this._rndf();
    let cutoff = 0;
    for (let i = 0; i < probs.length - 1; ++i) {
      cutoff += probs[i];
      if (point < cutoff) return i;
    }
    return probs.length - 1;
  }

  /*
   * Returns the selected index from a probability distribution
   * (probabilities do NOT need to sum to 1)
   * TODO: test (more general version)
   */
  pselect2(weights) {
    const sum = weights.reduce((acc, ele) => acc + ele, 0);
    let rand = Math.random() * sum; // from 0 - sum
    return weights.find(ele => (rand -= ele) < 0);
  }

  /*
    Returns a normalised probability distribution (summing to 1) for arbitrary positive weights
    If temperature is provided this is basically the softmax, otherwise it simple normalisation
    Temperature parameter: range is between 0 and +Infinity (excluding both).
    Lower values move the highest-weighted output toward a probability of 1.0.
    Higher values tend to even out all the probabilities
  */
  ndist(weights, temp) {
    const probs = [];
    let sum = 0;
    if (temp) { // have temp, do softmax
      if (temp < 0.01) temp = 0.01;
      for (let i = 0; i < weights.length; i++) {
        const pr = Math.exp(weights[i] / temp);
        sum += pr;
        probs.push(pr);
      }
    }
    else { // no temp here
      for (let i = 0; i < weights.length; i++) {
        if (weights[i] < 0) throw Error('Weights must be positive');
        sum += weights[i];
        probs.push(weights[i]);
      }
    }
    return probs.map(p => p /= sum);
  }

  /*
    Returns a random float, or item from an array
    random() -> 0 < 1
    random(k) -> 0 < k
    random(j,k) -> j < k
    random(arr) -> item from arr
    random(arr, func) -> item from arr, map => func
  */
  random() {
    const crand = this._rndf();
    if (!arguments.length) return crand;
    if (Array.isArray(arguments[0])) {
      const arr = arguments[0];
      return arr[Math.floor(crand * arr.length)];
    }
    return arguments.length === 1 ? crand * arguments[0] :
      crand * (arguments[1] - arguments[0]) + arguments[0];
  }

  /*
    Returns a random float between min and max, centered around bias
    @bias - the center point of the distribution (min => x < max)
    @influence - how close result is likely to be to bias (0-1)
  */
  randomBias(min, max, bias, influence = 0.5) { // @TODO: test/doc
    const base = this._rndf() * max + min;
    const mix = this._rndf() * influence;
    return base * (1 - mix) + bias * mix;
  } // adapted from: https://github.com/georgedoescode/generative-utils

  // ////////////////////////////////////////////////////////////////////////////////////

  _rndi() { // int between 0 and max value
    let y;
    let kk;
    const mag01 = new Array(0x0, this.MATRIX_A);
    if (this.mti >= this.N) {
      if (this.mti == this.N + 1) this.seed(5489);
      for (kk = 0; kk < this.N - this.M; kk++) {
        y = (this.mt[kk] & this.UPPER_MASK) | (this.mt[kk + 1] & this.LOWER_MASK);
        this.mt[kk] = this.mt[kk + this.M] ^ (y >>> 1) ^ mag01[y & 0x1];
      }
      for (; kk < this.N - 1; kk++) {
        y = (this.mt[kk] & this.UPPER_MASK) | (this.mt[kk + 1] & this.LOWER_MASK);
        this.mt[kk] = this.mt[kk + (this.M - this.N)] ^ (y >>> 1) ^ mag01[y & 0x1];
      }
      y = (this.mt[this.N - 1] & this.UPPER_MASK) | (this.mt[0] & this.LOWER_MASK);
      this.mt[this.N - 1] = this.mt[this.M - 1] ^ (y >>> 1) ^ mag01[y & 0x1];
      this.mti = 0;
    }
    y = this.mt[this.mti++];
    y ^= (y >>> 11);
    y ^= (y << 7) & 0x9d_2c_56_80;
    y ^= (y << 15) & 0xef_c6_00_00;
    y ^= (y >>> 18);
    return y >>> 0;
  }

  _rndf() { // float between 0 and 1
    return this._rndi() * (1.0 / 4_294_967_296.0);
  }

}

export default SeededRandom;