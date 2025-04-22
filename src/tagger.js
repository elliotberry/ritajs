import Utility from "./util.js"

/**
 * @class Tagger
 * @memberof module:rita
 */
class Tagger {
  /**
   * Create a Tagger.
   * @param {any} parent - RiTa parent class.
   */
  constructor(parent) {
    this.RiTa = parent
  }

  /**
   * Applies a customized subset of the Brill transformations
   * @param {string[]} words
   * @param {string[]} result
   * @param {string[]} choices
   * @param {boolean} dbug
   * @returns
   */
  _applyContext(words, result, choices, dbug) {
    // Apply transformations
    for (let index = 0, l = words.length; index < l; index++) {
      const word = words[index]
      let tag = result[index]
      if (!word || word.length === 0) continue

      if (tag === undefined) {
        tag = ""
        if (!this.RiTa.SILENT)
          console.warn(
            `\n[WARN] Unexpected state in _applyContext for idx=${index}`,
            words,
            "\n"
          )
      }

      // transform 1a: DT, {VBD | VBP | VB} --> DT, NN
      if (index > 0 && result[index - 1] === "dt") {
        if (tag.startsWith("vb")) {
          tag = "nn"
          // transform 7: if a word has been categorized as a common noun
          // and it ends with "s", then set its type to plural noun (NNS)
          if (/^.*[^s]s$/.test(word) && !this.RiTa.MASS_NOUNS.includes(word)) {
            tag = "nns"
          }
          //dbug && this._log("1a", word, tag);
        }

        // transform 1b: DT, {RB | RBR | RBS} --> DT, {JJ | JJR | JJS}
        else if (tag.startsWith("rb")) {
          tag = tag.length > 2 ? `jj${tag.charAt(2)}` : "jj"
          //dbug && this._log("1b", word, tag);
        }
      }

      // transform 2: convert a noun to a number (cd) if it is
      // all digits and/or a decimal "."
      if (tag.startsWith("n") && Utility.isNum(word)) {
        tag = "cd"
        //dbug && this._log(2, word, tag);
      } // mods: dch (add choice check above) <---- ? >

      // transform 3: convert a noun to a past participle if
      // word ends with "ed" and (following any nn or prp?)
      if (
        index > 0 &&
        tag.startsWith("n") &&
        word.endsWith("ed") &&
        /^(nn|prp)$/.test(result[index - 1]) &&
        !word.endsWith("eed")
      ) {
        //dbug && this._log(3, word, tag);
        tag = "vbn"
      }

      // transform 4: convert any type to adverb if it ends in "ly";
      if (word.endsWith("ly")) {
        tag = "rb"
        //dbug && this._log(4, word, tag);
      }

      // transform 5: convert a common noun (NN or NNS) to a (only if longer than 4 letters)
      // adjective if it ends with "al", special-case for mammal
      if (
        word.length > 4 &&
        tag.startsWith("nn") &&
        word.endsWith("al") &&
        word != "mammal"
      ) {
        tag = "jj"
        //dbug && this._log(5, word, tag);
      }

      // transform 6: convert a noun to a verb if the
      // preceeding word is modal
      if (index > 0 && tag.startsWith("nn") && result[index - 1].startsWith("md")) {
        tag = "vb"
        //dbug && this._log(6, word, tag);
      }

      //transform 7(dch): convert a vb to vbn when following vbz/'has'
      // (She has ridden, He has rode)
      if (tag === "vbd" && index > 0 && /^(vbz)$/.test(result[index - 1])) {
        tag = "vbn"
        //dbug && this._log(7, word, tag);
      }

      // transform 8: convert a common noun to a present
      // participle verb (i.e., a gerund)
      if (
        tag.startsWith("nn") &&
        word.endsWith("ing") &&
        this.hasTag(choices[index], "vbg")
      ) {
        // fixed for 'fishing' and etc
        tag = "vbg"
        //dbug && this._log(8, word, tag);
      }

      // transform 9(dch): convert plural nouns (which are also 3sg-verbs) to
      // 3sg-verbs when following a singular noun (the dog dances, Dave dances, he dances)
      if (
        index > 0 &&
        tag === "nns" &&
        this.hasTag(choices[index], "vbz") &&
        /^(nn|prp|nnp)$/.test(result[index - 1])
      ) {
        tag = "vbz"
        //dbug && this._log(9, word, tag);
      }

      // transform 10(dch): convert common nouns to proper
      // nouns when they start w' a capital
      if (tag.startsWith("nn") && /^[A-Z]/.test(word)) {
        //if it is not at the start of a sentence or it is the only word
        // or when it is at the start of a sentence but can't be found in the dictionary
        const sing = this.RiTa.singularize(word.toLowerCase())
        if (
          words.length === 1 ||
          index > 0 ||
          (index == 0 && !this._lexHas("nn", sing))
        ) {
          tag = tag.endsWith("s") ? "nnps" : "nnp"
          //dbug && this._log(10, word, tag);
        }
      }

      // transform 11(dch): convert plural nouns (which are also 3sg-verbs)
      // to 3sg-verbs when followed by adverb
      if (
        index < result.length - 1 &&
        tag == "nns" &&
        result[index + 1].startsWith("rb") &&
        this.hasTag(choices[index], "vbz")
      ) {
        tag = "vbz"
        //dbug && this._log(11, word, tag);
      }

      // transform 12(dch): convert plural nouns which have an entry
      // for their base form to vbz
      if (tag === "nns") {
        // is preceded by one of the following
        if (index > 0 && ["cc", "nn", "nnp", "prp"].includes(result[index - 1])) {
          // if word is ends with s or es and is 'nns' and has a vb
          if (this._lexHas("vb", this.RiTa.singularize(word))) {
            tag = "vbz"
            //dbug && this._log(12, word, tag);
          }
        } // if only word and not in lexicon
        else if (words.length === 1 && choices[index].length < 2) {
          // there is always choices[i][0] which is result[i]
          // (when the word is not in lexicon, generated by _derivePosData())
          // if the stem of a single word could be both nn and vb, return nns
          // only return vbz when the stem is vb but not nn
          const sing = this.RiTa.singularize(word.toLowerCase())
          if (!this._lexHas("nn", sing) && this._lexHas("vb", sing)) {
            //hmm any example?
            tag = "vbz"
            //dbug && this._log(12, word, tag);
          }
        }
      }

      // transform 13(cqx): convert a vb/ potential vb to vbp
      // when following nns (Elephants dance, they dance)
      if (
        (tag === "vb" || (tag === "nn" && this.hasTag(choices[index], "vb"))) &&
        index > 0 &&
        /^(nns|nnps|prp)$/.test(result[index - 1])
      ) {
        tag = "vbp"
        //dbug && this._log(13, word, tag);
      }

      // issue#83 sequential adjectives(jc): (?:dt)? (?:jj)* (nn) (?:jj)* nn
      // && $1 can be tagged as jj-> $1 convert to jj (e.g a light blue sky)
      if (tag === "nn" && result.slice(index + 1).includes("nn")) {
        const index_ = result.slice(index + 1).indexOf("nn")
        let allJJ = true // between nn and nn are all jj
        for (let k = 0; k < index_; k++) {
          if (result[index + 1 + k] !== "jj") {
            allJJ = false
            break
          }
        }
        if (allJJ && this.allTags(word).includes("jj")) {
          tag = "jj"
        }
      }

      // https://github.com/dhowe/rita/issues/148
      // "there"
      if (word.toLowerCase() === "there") {
        if (words[index + 1] && EX_BE.has(words[index + 1])) {
          tag = "ex"
        }
        if (index > 0 && result[index - 1] === "in") {
          tag = "nn"
        }
      }

      // https://github.com/dhowe/rita/issues/65 #HWF
      if (word.includes("-")) {
        if (result[index] !== "__HYPH__") continue // in dict
        if (word === "--") continue // double hyphen treated as dash
        if (HYPHENATEDS.hasOwnProperty(word)) {
          result[index] = HYPHENATEDS[word]
          if (dbug) console.log(`${word}: ${HYPHENATEDS[word]} ACC: special`)
          continue
        }
        tag = this._tagCompoundWord(word, tag, result, words, index, dbug)
      }

      result[index] = tag
    }

    return result
  }

  _checkPluralNounOrVerb(stem, result) {
    const pos = this.RiTa.lexicon._posArr(stem)
    if (pos) {
      if (pos.includes("nn")) result.push("nns") // ?? any case
      if (pos.includes("vb")) result.push("vbz")
    }

    // finally check irregular verb list
    if ((!pos || !pos.includes("vbz")) && this._isNoLexIrregularVerb(stem))
      result.push("vbz")
  }

  _derivePosData(word, noGuessing) {
    // noGuessing arg disables the final guess when true,
    // and instead returns an empty array if no rules match

    if (word === "the" || word === "a") return ["dt"]

    /*
      Try for a verb or noun inflection 
      VBD 	Verb, past tense
      VBG 	Verb, gerund or present participle
      VBN 	Verb, past participle
      VBP 	Verb, non-3rd person singular present
      VBZ 	Verb, 3rd person singular present
      NNS   Noun, plural
    */
    const lex = this.RiTa.lexicon
    const tags = lex._posArr(word)

    if (word.endsWith("ress")) {
      let pos = lex._posArr(word.slice(0, Math.max(0, word.length - 3))) // murderess
      if (pos && pos.includes("vb")) {
        //murderess - murder
        return ["nn"]
      }
      pos = lex._posArr(word.slice(0, Math.max(0, word.length - 4))) // actress, waitress
      if (pos && pos.includes("vb")) {
        //actress - act
        return ["nn"]
      }
    }

    if (word.endsWith("or")) {
      let pos = lex._posArr(word.slice(0, Math.max(0, word.length - 2))) // actor, motor, editor
      if (pos && pos.includes("vb")) {
        //actress - act
        return ["nn"]
      }
      pos = lex._posArr(`${word.slice(0, Math.max(0, word.length - 2))}e`) // investigator, creator
      if (pos && pos.includes("vb")) {
        return ["nn"]
      }
    }

    if (word.endsWith("er")) {
      let pos = lex._posArr(word.slice(0, Math.max(0, word.length - 2))) // builder

      if (pos && pos.includes("vb")) return ["nn"]

      pos = lex._posArr(word.slice(0, Math.max(0, word.length - 1))) // dancer
      if (pos && pos.includes("vb")) return ["nn"]

      if (word.charAt(word.length - 3) === word.charAt(word.length - 4)) {
        pos = lex._posArr(word.slice(0, Math.max(0, word.length - 3))) // programmer
        if (pos && pos.includes("vb")) return ["nn"]
      }
    }

    if (word.endsWith("ies")) {
      // 3rd-person sing. present (satisfies, falsifies)
      const check = `${word.slice(0, Math.max(0, word.length - 3))}y`
      const pos = lex._posArr(check)
      if (pos && pos.includes("vb")) return ["vbz"]
    } else if (word.endsWith("s")) {
      // singular noun ('bonus', 'census'), plural noun or vbz

      const result = []

      // remove suffix (s) and test (eg 'hates', 'cakes')
      this._checkPluralNounOrVerb(word.slice(0, Math.max(0, word.length - 1)), result)

      if (word.endsWith("es")) {
        // remove suffix (es) and test (eg 'repossesses')
        this._checkPluralNounOrVerb(word.slice(0, Math.max(0, word.length - 2)), result)

        // singularize and test (eg 'thieves')
        this._checkPluralNounOrVerb(this.RiTa.singularize(word), result)
      }

      if (result.length > 0) return result
    }

    if (word.endsWith("ed")) {
      // simple past or past participle
      const pos =
        lex._posArr(word.slice(0, Math.max(0, word.length - 1))) ||
        lex._posArr(word.slice(0, Math.max(0, word.length - 2))) ||
        lex._posArr(word.slice(0, Math.max(0, word.length - 3))) //e.g deterred
      if (pos && pos.includes("vb")) {
        return ["vbd", "vbn"] // hate-> hated || row->rowed || deter -> deterred
      }
    }

    if (word.endsWith("ing")) {
      const stem = word.slice(0, Math.max(0, word.length - 3))
      if (stem) {
        let pos = lex._posArr(stem)
        if (pos && pos.includes("vb")) {
          // vbg can be noun (in some contexts), for example: 'His acting is good'
          // this is more for getting all 'possible' labels in tag() function as
          // elsewhere tags are analyzed by context according to ruleset.
          return ["vbg", "nn"] // assenting
        }
        pos = lex._posArr(`${stem}e`) // hate
        if (pos && pos.includes("vb")) {
          return ["vbg", "nn"] //  e.g: let's go hiking
        }
        // else
        if (word.charAt(word.length - 4) === word.charAt(word.length - 5)) {
          pos = lex._posArr(stem.slice(0, Math.max(0, stem.length - 1))) // e.g running
          if (pos && pos.includes("vb")) {
            return ["vbg", "nn"] //  e.g. the tripping of an opponent is a foul in football
          }
        }
      }
    }

    if (word.endsWith("ly")) {
      const stem = word.slice(0, Math.max(0, word.length - 2))
      if (stem) {
        let pos = lex._posArr(stem)
        if (pos && pos.includes("jj")) {
          // beautifully - beautiful
          return ["rb"]
        }
        if (stem.charAt(stem.length - 1) === "i") {
          pos = lex._posArr(`${stem.slice(0, Math.max(0, stem.length - 1))}y`)
          if (pos && pos.includes("jj")) {
            // happily - happy
            return ["rb"]
          }
        }
      }
    }

    // Check if this could be a plural noun form
    if (this.isLikelyPlural(word)) return ["nns"]

    // Check if is irregular past part of a verb
    const conj = this.RiTa.conjugator
    if (conj.IRREG_PAST_PART.includes(word)) return ["vbd"]

    // Give up
    return (
      noGuessing ? []
      : word.endsWith("ly") ? ["rb"]
      : word.endsWith("s") ? ["nns"]
      : ["nn"]
    )
  }

  _handleSingleLetter(c) {
    if (c === "a" || c === "A") return "dt"
    if (c >= "0" && c <= "9") return "cd"
    return c === "I" ? "prp" : c
  }

  _isNoLexIrregularVerb(stem) {
    return Object.values(this.RiTa.conjugator.IRREG_VERBS_NOLEX).includes(stem)
  }

  _lexHas(pos, word) {
    // takes ([n|v|a|r] or a full tag
    if (typeof word !== "string") {
      return
    }
    const tags = this.RiTa.lexicon._posArr(word)
    if (!tags) return false
    for (const tag of tags) {
      if (pos === tag) return true
      if (
        (pos === "n" && NOUNS.has(tag)) ||
        (pos === "v" && VERBS.has(tag)) ||
        (pos === "r" && ADVS.has(tag)) ||
        (pos === "a" && ADJS.has(/*.isAdjTag*/ tag))
      ) {
        return true
      }
    }
  }

  _log(index, frm, to) {
    // log custom tag
    console.log(`\n  Custom(${index}) tagged '${frm}' -> '${to}'\n\n`)
  } // debug only: not available in built version since 'dbug' in tag() is 0

  _safeConcat(a, b) {
    if (a && b) return a.concat(b)
    if (a) return a
    if (b) return b
  } // ! this function is never used

  //////////////////////////////////////////////////////////////////

  // determine tag for compound (hyphenated) word
  _tagCompoundWord(word, tag, result, context, index, dbug) {
    // #HWF

    const words = word.split("-")
    const firstPart = words[0]
    const lastPart = words.at(-1)
    const firstPartAllTags = this.allTags(firstPart)
    const lastPartAllTags = this.allTags(lastPart)

    if (
      words.length === 2 &&
      VERB_PREFIX.has(words[0]) &&
      lastPartAllTags.some((t) => t.startsWith('vb'))
    ) {
      tag = lastPartAllTags.find((t) => t.startsWith('vb'))
      if (dbug) console.log(`${word}: ${tag} ACC: prefix-vb`)
    } else if (
      words.length === 2 &&
      NOUN_PREFIX.has(words[0]) &&
      lastPartAllTags.some((t) => t.startsWith('nn'))
    ) {
      tag = lastPartAllTags.find((t) => t.startsWith('nn'))
      if (dbug) console.log(`${word}: ${tag} ACC: prefix-nn`)
    } else if (firstPartAllTags.some((t) => t.startsWith('cd'))) {
      // numbers
      let allCD = true
      for (let z = 1; z < words.length; z++) {
        const part = words[z]
        if (!this.allTags(part).some((t) => t.startsWith('cd'))) {
          allCD = false
          break
        }
      }
      if (allCD) {
        tag = "cd"
        if (dbug) console.log(`${word}: ${tag} ACC: cd(-cd)+ `)
      } else {
        //ordinal number like twenty-first
        tag = "jj"
        if (dbug) console.log(`${word}: ${tag} ACC: cd(-jj/nn)+ `)
      }
    } else if (
      firstPartAllTags.some((t) => t.startsWith("jj")) &&
      words.length === 2 &&
      lastPartAllTags.some((t) => t.startsWith("nn"))
    ) {
      tag = "jj"
      if (dbug) console.log(`${word}: ${tag} ACC: jj-nn`)
    } else if (
      firstPartAllTags.includes("vb") &&
      !firstPartAllTags.some((t) => t.startsWith("jj"))
    ) {
      // first part is vb
      if (words.length === 2 && lastPartAllTags.includes("in")) {
        // verb phrase with in, e.g. blush-on tip-off get-together run-in
        tag = "nn"
        if (dbug) console.log(`${word}: ${tag} ACC: vb-in`)
      } else if (
        words.length === 2 &&
        lastPartAllTags.some((t) => /^(vb[gdp])/.test(t)) &&
        !lastPartAllTags.some((t) => /^vb$/.test(t))
      ) {
        // man-eating
        tag = "jj"
        if (dbug) console.log(`${word}: ${tag} ACC: vb-vbg/vbd/vbp`)
      } else if (
        words.length === 2 &&
        lastPartAllTags.some((t) => t.startsWith("jj"))
      ) {
        tag = "jj"
        if (dbug) console.log(`${word}: ${tag} ACC: vb-jj`)
      } else {
        tag = "nn"
        if (dbug) console.log(`${word}: ${tag} ACC: vb(-.)+ general`)
      }
    } else if (
      (lastPartAllTags.some((t) => /^(jj[rs]?)/.test(t)) &&
        !lastPartAllTags.some((t) => t.startsWith("nn"))) ||
      lastPartAllTags.some((t) => /^vb[dgn]/.test(t))
    ) {
      // last part is jj or vbd/vbn/vbg
      tag = "jj"
      if (dbug) console.log(`${word}: ${tag} ACC: last part jj or vbd/vbg`)
    } else if (lastPartAllTags.some((t) => /^[n]/.test(t))) {
      // last part is a noun
      if (firstPartAllTags.some((t) => /^(in|rb)/.test(t))) {
        // over-the-counter; before-hand etc
        tag = "jj"
        if (dbug) console.log(`${word}: ${tag} ACC: in/rb(-.)*-nn`)
      } else {
        let lastNounIsMajor = true
        for (let z = 0; z < words.length - 1; z++) {
          const part = words[z]
          if (!this.allTags(part).some((t) => /^([jn]|dt|in)/.test(t))) {
            lastNounIsMajor = false
            break
          }
        }
        if (lastNounIsMajor) {
          tag = "nn"
          if (dbug) console.log(`${word}: ${tag} ACC: all nn`)
        } else {
          tag = "jj"
          if (dbug) console.log(`${word}: ${tag} ACC: (.-)+nn`)
        }
      }
    } else if (firstPartAllTags.some((t) => t.startsWith("n"))) {
      // first part can be a noun: father-in-law etc.
      // numbers depend on this noun
      tag = this.RiTa.inflector.isPlural(words[0]) ? "nns" : "nn"
      if (dbug) console.log(`${word}: ${tag} ACC: nn(-.)+`)
    } else {
      tag = "nn" //generually it should be nn
      if (dbug) console.log(`${word}: ${tag} ACC: no rule hit`)
    }

    // change according to context
    if (result[index + 1] && result[index + 1].startsWith("n") && tag.startsWith("n")) {
      //next word is a noun
      return "jj"
    } else if (tag === "jj" && result[index + 1] && result[index + 1].startsWith("v")) {
      //next word is a verb, last part is rb/verb
      tag = "rb"
    } else if (result[index + 1] && result[index + 1].startsWith("v") && tag === "jj") {
      return "rb"
    } else if (
      tag === "jj" &&
      context[index - 1] &&
      ARTICLES.has(context[index - 1].toLowerCase().trim()) &&
      (!context[index + 1] ||
        (result[index + 1] && /^(v|cc|in|md|w)/.test(result[index + 1])) ||
        this.RiTa.isPunct(context[index + 1]))
    ) {
      return "nn"
    }
    return tag
  }

  allTags(word, options = {}) {
    // returns an array of choices

    const noGuessing = options.noGuessing || false
    const noDerivations = options.noDerivations || false

    if (word && typeof word === "string" && word.length) {
      const posData = this.RiTa.lexicon._posArr(word)
      if (posData && posData.length > 0) return posData
      if (word.includes("-") && options.noGuessingOnHyphenated) return [] //#HWF
      if (!noDerivations) return this._derivePosData(word, noGuessing)
    }

    return [] // empty array
  }

  hasTag(choices, tag) {
    if (!Array.isArray(choices)) return false
    const choiceString = choices.join()
    return choiceString.indexOf(tag) > -1
  }

  /* convert from array of tags to a string with tags inline */
  inlineTags(words, tags, delimiter) {
    if (!words || words.length === 0) return ""

    if (words.length !== tags.length) {
      throw new Error(
        `Tagger: invalid state: words(${words.length}` +
          ")=" +
          words +
          " tags(" +
          tags.length +
          ")=" +
          tags
      )
    }

    delimiter = delimiter || "/"

    let sb = ""
    for (const [i, word] of words.entries()) {
      sb += word
      if (!this.RiTa.isPunct(word)) {
        sb += delimiter + tags[i]
      }
      sb += " "
    }
    return sb.trim()
  }

  isAdjective(word) {
    const pos = this.allTags(word)
    return pos.some((p) => ADJS.has(p))
  }

  isAdverb(word) {
    const pos = this.allTags(word)
    return pos.some((p) => ADVS.has(p))
  }

  isLikelyPlural(word) {
    return this._lexHas("n", this.RiTa.singularize(word))
    //|| this.RiTa.inflector.isPlural(word);
  }

  isNoun(word) {
    // see https://github.com/dhowe/rita/issues/130
    const pos = this.allTags(word, { noGuessing: true })
    return pos.some((p) => NOUNS.has(p))
  }

  isVerb(word, options) {
    const conj = this.RiTa.conjugator

    // check irregular verbs (added 7/31/21)
    if (this._isNoLexIrregularVerb(word)) return true
    if (conj.IRREG_VERBS_LEX_VB.hasOwnProperty(word)) return true
    if (conj.IRREG_VERBS_NOLEX.hasOwnProperty(word)) return true

    // any verbs (vb*) in lexicon
    const pos = this.allTags(word, options)
    return pos.some((p) => VERBS.has(p))
  }

  /**
   * Tags an array of words with their part-of-speech
   * @param {(string|string[])} input - The input containing a word or words
   * @param {object} [opts] - options for the tagging {inline, simple}
   * @param {boolean} [opts.inline] - tags are returned inline with words
   * @param {boolean} [opts.simple] - use simple tags (noun=n,verb=v,adverb=a,adjective=r)
   * @returns {any} the pos tag(s) or string with tags inline
   */
  tag(
    input,
    options = {
      inline: false,
      simple: false
    }
  ) {
    const result = []
    const choices2d = []
    // @ts-ignore
    const dbug = options?.dbug || false

    if (!input || !input.length) return options.inline ? "" : []

    /** @type {string[]} */
    let words
    if (Array.isArray(input)) {
      words = input
    } else {
      // likely a string
      if (!input.trim().length) {
        // empty string
        return options.inline ? "" : []
      }
      // else tokenize to array
      words = this.RiTa.tokenizer.tokenize(input)
    }

    for (let i = 0, l = words.length; i < l; i++) {
      const word = words[i]
      if (!word || !word.length) continue

      if (this.RiTa.isPunct(word)) {
        result[i] = word
      } else if (word.length === 1) {
        result[i] = this._handleSingleLetter(word)
      } else {
        //#HWF: skip guessing for not-in-dict hyphenated words as we deal with these later
        const opts = this.allTags(word, { noGuessingOnHyphenated: true })
        choices2d[i] = opts // || []; // all options
        result[i] = opts.length ? opts[0] : "__HYPH__" // first option
      }
    }

    // Adjust pos according to transformation rules
    const tags = this._applyContext(words, result, choices2d, dbug)

    if (options.simple) {
      // convert to simple tags
      for (let i = 0; i < tags.length; i++) {
        if (NOUNS.has(tags[i])) tags[i] = "n"
        else if (VERBS.has(tags[i])) tags[i] = "v"
        else if (ADJS.has(tags[i])) tags[i] = "a"
        else if (ADVS.has(tags[i])) tags[i] = "r"
        else tags[i] = "-" // default: other
      }
    }

    return options.inline ? this.inlineTags(words, tags) : tags
  }
}

const ADJS = new Set(["jj", "jjr", "jjs"])
const ADVS = new Set(["rb", "rbr", "rbs", "rp"])
const NOUNS = new Set(["nn", "nns", "nnp", "nnps"])
const VERBS = new Set(["vb", "vbd", "vbg", "vbn", "vbp", "vbz"])
const EX_BE = new Set([
  "is",
  "are",
  "was",
  "were",
  "isn't",
  "aren't",
  "wasn't",
  "weren't"
])

//#HWF
const HYPHENATEDS = {
  "ho-hum": "uh", // by rules should be nn, coz all parts are noun as ho will be recognise as nn in the algorithm
  "king-size": "jj", // by rules should be nn, coz all parts are noun
  "knee-length": "jj", // by rules should be nn, coz all parts are noun, like 'gift-wrap'
  "nitty-gritty": "nn", // by rules should be jj, coz gritty is jj
  "roly-poly": "jj", // by rules should be nn, coz all parts are recognise as nn in the algorithm
  "topsy-turvy": "jj", // by rules should be nn, coz all parts are recognise as nn in the algorithm
  "well-being": "nn" // by rules should be jj, like 'good-looking'
}
const VERB_PREFIX = new Set([
  "de",
  "over",
  "re",
  "dis",
  "un",
  "mis",
  "out",
  "pre",
  "post",
  "co",
  "fore",
  "inter",
  "sub",
  "trans",
  "under"
])
const NOUN_PREFIX = new Set([
  "anti",
  "auto",
  "de",
  "dis",
  "un",
  "non",
  "co",
  "over",
  "under",
  "up",
  "down",
  "hyper",
  "mono",
  "bi",
  "uni",
  "di",
  "semi",
  "omni",
  "mega",
  "mini",
  "macro",
  "micro",
  "counter",
  "ex",
  "mal",
  "neo",
  "out",
  "poly",
  "pseudo",
  "super",
  "sub",
  "sur",
  "tele",
  "tri",
  "ultra",
  "vice"
])
//const ADJECTIVE_PREFIX = ["dis", "non", "semi", "un"]; // JC: not used?
const ARTICLES = new Set(["the", "a", "an", "some"])

export default Tagger
