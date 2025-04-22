/**
 * @class Util
 * @memberof module:rita
 */
const Utility = {
  isNum(n) {
    return !isNaN(Number.parseFloat(n)) && isFinite(n)
  },

  numOpt(options, name, def = 0) {
    return Utility.isNum(options?.[name]) ? options[name] : def
  },

  syllablesFromPhones(input) {
    // adapted from FreeTTS

    function extend(l1, l2) {
      for (let index = 0; index < l2.length; index++) l1.push(l2[index])
    }

    if (!input || input.length === 0) return ""

    let dbug
    let internuclei = []
    const syllables = [] // returned data structure
    const sylls = typeof input == "string" ? input.split("-") : input

    for (const [index, syll] of sylls.entries()) {
      let phoneme = syll.trim()
      let stress
      if (phoneme.length === 0) continue

      const last = phoneme.charAt(phoneme.length - 1)
      if (this.isNum(last)) {
        stress = last
        phoneme = phoneme.slice(0, Math.max(0, phoneme.length - 1))
      }

      if (dbug)
        console.log(
          `${index})${phoneme} stress=${stress} inter=${internuclei.join(":")}`
        )

      if (Utility.Phones.vowels.includes(phoneme)) {
        // Split the consonants seen since the last nucleus into coda and onset.
        let coda
        let onset

        // Make the largest onset we can. The 'split' variable marks the break point.
        for (let split = 0; split < internuclei.length + 1; split++) {
          coda = internuclei.slice(0, split)
          onset = internuclei.slice(split)

          if (dbug)
            console.log(
              `  ${split}) onset=${onset.join(":")}` +
                "  coda=" +
                coda.join(":") +
                "  inter=" +
                internuclei.join(":")
            )

          // If we are looking at a valid onset, or if we're at the start of the word
          // (in which case an invalid onset is better than a coda that doesn't follow
          // a nucleus), or if we've gone through all of the onsets and we didn't find
          // any that are valid, then split the nonvowels we've seen at this location.
          const bool = Utility.Phones.onsets.includes(onset.join(" "))
          if (bool || syllables.length === 0 || onset.length === 0) {
            if (dbug) console.log(`  break ${phoneme}`)
            break
          }
        }

        // Tack the coda onto the coda of the last syllable.
        // Can't do it if this is the first syllable.
        if (syllables.length > 0) {
          extend(syllables.at(-1)[3], coda)
          if (dbug)
            console.log(
              `  tack: ${coda} -> len=` +
                syllables.at(-1)[3].length +
                " [" +
                syllables.at(-1)[3] +
                "]"
            )
        }

        // Make a new syllable out of the onset and nucleus.
        const toPush = [[stress], onset, [phoneme], []]
        syllables.push(toPush)

        // At this point we've processed the internuclei list.
        internuclei = []
      } else if (!Utility.Phones.consonants.includes(phoneme) && phoneme != " ") {
        throw new Error(`Invalid phoneme: ${phoneme}`)
      } else {
        // a consonant
        internuclei.push(phoneme)
      }
    }

    // Done looping through phonemes. We may have consonants left at the end.
    // We may have even not found a nucleus.
    if (internuclei.length > 0) {
      if (syllables.length === 0) {
        syllables.push([[undefined], internuclei, [], []])
      } else {
        extend(syllables.at(-1)[3], internuclei)
      }
    }
    return Utility.syllablesToPhones(syllables)
  },

  // Takes a syllabification and turns it into a string of phonemes,
  // delimited with dashes, with spaces between syllables
  syllablesToPhones(syllables) {
    let index
    let index_
    const returnValue = []
    for (index = 0; index < syllables.length; index++) {
      const syl = syllables[index]
      const stress = syl[0][0]
      const onset = syl[1]
      const nucleus = syl[2]
      const coda = syl[3]

      if (stress && nucleus.length > 0) nucleus[0] += stress

      const data = []
      for (index_ = 0; index_ < onset.length; index_++) data.push(onset[index_])
      for (index_ = 0; index_ < nucleus.length; index_++) data.push(nucleus[index_])
      for (index_ = 0; index_ < coda.length; index_++) data.push(coda[index_])
      returnValue.push(data.join("-"))
    }

    return returnValue.join(" ")
  },
};

// CLASSES ////////////////////////////////////////////////////

/**
 * @class RE
 * @memberof module:rita
 */
class RE {
  constructor(regex, offset, suffix) {
    this.raw = regex
    this.regex = new RegExp(regex)
    this.offset = offset
    this.suffix = suffix || ""
  }

  applies(word) {
    return this.regex.test(word)
  }

  fire(word) {
    return this.truncate(word) + this.suffix
  }

  toString() {
    return `/${this.raw}/`
  }

  truncate(word) {
    return this.offset === 0 ? word : word.slice(0, Math.max(0, word.length - this.offset))
  }
}

Utility.Numbers = {
  fromWords: {
    eight: 8,
    eighteen: 18,
    eighty: 80,
    eleven: 11,
    fifteen: 15,
    fifty: 50,
    five: 5,
    forty: 40,
    four: 4,
    fourteen: 14,
    nine: 9,
    nineteen: 19,
    ninety: 90,
    one: 1,
    seven: 7,
    seventeen: 17,
    seventy: 70,
    six: 6,
    sixteen: 16,
    sixty: 60,
    ten: 10,
    thirteen: 13,
    thirty: 30,
    three: 3,
    twelve: 12,
    twenty: 20,
    two: 2,
    zero: 0
  },
  toWords: {
    0: "zero",
    1: "one",
    10: "ten",
    11: "eleven",
    12: "twelve",
    13: "thirteen",
    14: "fourteen",
    15: "fifteen",
    16: "sixteen",
    17: "seventeen",
    18: "eighteen",
    19: "nineteen",
    2: "two",
    20: "twenty",
    3: "three",
    30: "thirty",
    4: "four",
    40: "forty",
    5: "five",
    50: "fifty",
    6: "six",
    60: "sixty",
    7: "seven",
    70: "seventy",
    8: "eight",
    80: "eighty",
    9: "nine",
    90: "ninety"
  }
}

Utility.Phones = {
  consonants: [
    "b",
    "ch",
    "d",
    "dh",
    "f",
    "g",
    "hh",
    "jh",
    "k",
    "l",
    "m",
    "n",
    "ng",
    "p",
    "r",
    "s",
    "sh",
    "t",
    "th",
    "v",
    "w",
    "y",
    "z",
    "zh"
  ],
  onsets: [
    "p",
    "t",
    "k",
    "b",
    "d",
    "g",
    "f",
    "v",
    "th",
    "dh",
    "s",
    "z",
    "sh",
    "ch",
    "jh",
    "m",
    "n",
    "r",
    "l",
    "hh",
    "w",
    "y",
    "p r",
    "t r",
    "k r",
    "b r",
    "d r",
    "g r",
    "f r",
    "th r",
    "sh r",
    "p l",
    "k l",
    "b l",
    "g l",
    "f l",
    "s l",
    "t w",
    "k w",
    "d w",
    "s w",
    "s p",
    "s t",
    "s k",
    "s f",
    "s m",
    "s n",
    "g w",
    "sh w",
    "s p r",
    "s p l",
    "s t r",
    "s k r",
    "s k w",
    "s k l",
    "th w",
    "zh",
    "p y",
    "k y",
    "b y",
    "f y",
    "hh y",
    "v y",
    "th y",
    "m y",
    "s p y",
    "s k y",
    "g y",
    "hh w",
    ""
  ],
  vowels: [
    "aa",
    "ae",
    "ah",
    "ao",
    "aw",
    "ax",
    "ay",
    "eh",
    "er",
    "ey",
    "ih",
    "iy",
    "ow",
    "oy",
    "uh",
    "uw"
  ]
}

Utility.RE = function (a, b, c) {
  return new RE(a, b, c)
}

/* TODO: needs test cases, then remove [ones,tens,teens],
 *  then add words for . and -, then uncomment and use in LTS
Util.numToWords = function(num) {

  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const teens = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];

  let nums = Util.Numbers.toWords;

  function millions(n) {
    return n >= 1000000 ? millions(Math.floor(n / 1000000))
      + " million " + thousands(n % 1000000)
      : thousands(n);
  }

  function thousands(n) {
    return n >= 1000 ? hundreds(Math.floor(n / 1000)) +
      " thousand " + hundreds(n % 1000)
      : hundreds(n);
  }

  function hundreds(n) {
    return n > 99 ? ones[Math.floor(n / 100)]
      + " hundred " + digits(n % 100)
      : digits(n);
  }

  function digits(n) {
    if (n < 10) return ones[n];
    else if (n >= 10 && n < 20) return teens[n - 10];
    return tens[Math.floor(n / 10)] + ' ' + ones[n % 10]
  }

  function digitsNew(n) {
    if (n <= 20) return nums[n+''];
    return nums[(Math.floor(n / 10)*10)+''] + ' ' + nums[n % 10];
  }

  if (typeof num === 'string') num = parseInt(num);
  if (num === 0) return "zero";
  if (!Util.isNum(num)) return num; // warning?
  return millions(num).replace(/\s+/g, ' ').trim();
}
*/

export default Utility
