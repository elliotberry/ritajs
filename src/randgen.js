import Utility from "./util.js"

/**
 * @class SeededRandom
 * @memberof module:rita
 */
class SeededRandom {
  // see https://github.com/bmurray7/mersenne-twister-examples/blob/master/javascript-mersenne-twister.js

  constructor() {
    this.N = 624
    this.M = 397
    this.MATRIX_A = 0x99_08_B0_DF
    this.UPPER_MASK = 0x80_00_00_00
    this.LOWER_MASK = 0x7F_FF_FF_FF
    this.mt = [this.N]
    this.mti = this.N + 1
    this.seed(Date.now())
  }

  _rndf() {
    // float between 0 and 1
    return this._rndi() * (1 / 4_294_967_296)
  }

  _rndi() {
    // int between 0 and max value
    let y
    let kk
    const mag01 = new Array(0x0, this.MATRIX_A)
    if (this.mti >= this.N) {
      if (this.mti == this.N + 1) this.seed(5489)
      for (kk = 0; kk < this.N - this.M; kk++) {
        y =
          (this.mt[kk] & this.UPPER_MASK) | (this.mt[kk + 1] & this.LOWER_MASK)
        this.mt[kk] = this.mt[kk + this.M] ^ (y >>> 1) ^ mag01[y & 0x1]
      }
      for (; kk < this.N - 1; kk++) {
        y =
          (this.mt[kk] & this.UPPER_MASK) | (this.mt[kk + 1] & this.LOWER_MASK)
        this.mt[kk] =
          this.mt[kk + (this.M - this.N)] ^ (y >>> 1) ^ mag01[y & 0x1]
      }
      y =
        (this.mt[this.N - 1] & this.UPPER_MASK) | (this.mt[0] & this.LOWER_MASK)
      this.mt[this.N - 1] = this.mt[this.M - 1] ^ (y >>> 1) ^ mag01[y & 0x1]
      this.mti = 0
    }
    y = this.mt[this.mti++]
    y ^= y >>> 11
    y ^= (y << 7) & 0x9D_2C_56_80
    y ^= (y << 15) & 0xEF_C6_00_00
    y ^= y >>> 18
    return y >>> 0
  }

  /*
    Returns a normalised probability distribution (summing to 1) for arbitrary positive weights
    If temperature is provided this is basically the softmax, otherwise it simple normalisation
    Temperature parameter: range is between 0 and +Infinity (excluding both).
    Lower values move the highest-weighted output toward a probability of 1.0.
    Higher values tend to even out all the probabilities
  */
  ndist(weights, temporary) {
    const probs = []
    let sum = 0
    if (temporary) {
      // have temp, do softmax
      if (temporary < 0.01) temporary = 0.01
      for (const weight of weights) {
        const pr = Math.exp(weight / temporary)
        sum += pr
        probs.push(pr)
      }
    } else {
      // no temp here
      for (const weight of weights) {
        if (weight < 0) throw new Error("Weights must be positive")
        sum += weight
        probs.push(weight)
      }
    }
    return probs.map((p) => (p /= sum))
  }

  /*
    Returns a single (selected) index from a normalised
    probability distribution (with probabilities summing to 1)
  */
  pselect(probs) {
    if (!probs || probs.length === 0) throw new Error("arg required")
    const point = this._rndf()
    let cutoff = 0
    for (let index = 0; index < probs.length - 1; ++index) {
      cutoff += probs[index]
      if (point < cutoff) return index
    }
    return probs.length - 1
  }

  /*
   * Returns the selected index from a probability distribution
   * (probabilities do NOT need to sum to 1)
   * TODO: test (more general version)
   */
  pselect2(weights) {
    const sum = weights.reduce((accumulator, ele) => accumulator + ele, 0)
    let rand = Math.random() * sum // from 0 - sum
    return weights.find((ele) => (rand -= ele) < 0)
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
    const crand = this._rndf()
    if (arguments.length === 0) return crand
    if (Array.isArray(arguments[0])) {
      const array = arguments[0]
      return array[Math.floor(crand * array.length)]
    }
    return arguments.length === 1 ?
        crand * arguments[0]
      : crand * (arguments[1] - arguments[0]) + arguments[0]
  }

  /*
    Returns a random float between min and max, centered around bias
    @bias - the center point of the distribution (min => x < max)
    @influence - how close result is likely to be to bias (0-1)
  */
  randomBias(min, max, bias, influence = 0.5) {
    // @TODO: test/doc
    const base = this._rndf() * max + min
    const mix = this._rndf() * influence
    return base * (1 - mix) + bias * mix
  } // adapted from: https://github.com/georgedoescode/generative-utils

  randomOrdering(argument) {
    if (!(Array.isArray(argument) || Utility.isNum(argument)))
      throw new Error("Expects [] or int")
    const o = Array.isArray(argument) ? argument : [...new Array(argument).keys()]
    for (
      let index, x, index_ = o.length;
      index_;
      index = Math.floor(this.random() * index_), x = o[--index_], o[index_] = o[index], o[index] = x
    ) {
      /* shuffle */
    }
    return o
  }

  // ////////////////////////////////////////////////////////////////////////////////////

  seed(number_) {
    this.mt[0] = number_ >>> 0
    for (this.mti = 1; this.mti < this.N; this.mti++) {
      const s = this.mt[this.mti - 1] ^ (this.mt[this.mti - 1] >>> 30)
      this.mt[this.mti] =
        ((((s & 0xFF_FF_00_00) >>> 16) * 1_812_433_253) << 16) +
        (s & 0x00_00_FF_FF) * 1_812_433_253 +
        this.mti
      this.mt[this.mti] >>>= 0
    }
  }

  shuffle(array) {
    const newArray = [...array]
    const length = newArray.length
    let index = length
    while (index--) {
      const p = Math.floor(this.random(length))
      const t = newArray[index]
      newArray[index] = newArray[p]
      newArray[p] = t
    }
    return newArray
  }
}

export default SeededRandom
