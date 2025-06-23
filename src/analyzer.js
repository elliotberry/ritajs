import LetterToSound from "./rita_lts.js";
import Utility from "./util.js";

const SP = ' ';
const E = '';

/**
 * @class Analyzer
 * @memberof module:rita
 */
class Analyzer {

  constructor(parent) {
    this.cache = {};
    this.RiTa = parent;
    this.lts = undefined;
  }

  //#HWF
  _computePhonesHyph(word, lex, options) {
    const rawPhones = [];
    for (const p of word.split("-")) {
      const part = this._computePhonesWord(p, lex, options, true);
      if (part && part.length > 0) rawPhones.push(part);
    }
    return rawPhones;
  }

  //#HWF this part is unchanged but move to a separated function
  _computePhonesWord(word, lex, options, isPart) {
    let rawPhones;
    const RiTa = this.RiTa;
    if (isPart) rawPhones = lex.rawPhones(word, { noLts: true });
    // if its a simple plural ending in 's',
    // and the singular is in the lexicon, add '-z' to end
    if (!rawPhones && word.endsWith('s')) {
      const sing = RiTa.singularize(word);
      rawPhones = lex.rawPhones(sing, { noLts: true });
      if (rawPhones) rawPhones += '-z'; // add 's' phone
    }

    // TODO: what about verb forms here?? Need test cases
    const silent = RiTa.SILENT || RiTa.SILENCE_LTS || (options && options.silent);

    // if no phones yet, try the lts-engine
    if (!rawPhones) {
      const ltsPhones = this.computePhones(word, options);
      if (ltsPhones && ltsPhones.length > 0) {
        if (!silent && lex.size()) {// && word.match(HAS_LETTER_RE)) {
          console.log(`[RiTa] Used LTS-rules for '${word}'`);
        }
        return Utility.syllablesFromPhones(ltsPhones);
      }
    }

    return rawPhones;
  }

  _computeRawPhones(word, lex, options) {
    return word.includes("-")  // #HWF
      ? this._computePhonesHyph(word, lex, options)
      : this._computePhonesWord(word, lex, options);
  }

  analyze(text, options) {
    const words = this.RiTa.tokenizer.tokenize(text);
    const tags = this.RiTa.pos(text, options); // tags are not cached
    const features = {
      phones: E,
      pos: tags.join(SP),
      stresses: E,
      syllables: E,
      tokens: words.join(SP)
    }

    for (const word of words) {
      let { phones, stresses, syllables } = this.analyzeWord(word, options);
      features.phones += SP + phones;
      features.stresses += SP + stresses;
      features.syllables += SP + syllables;
    }
    for (const k of Object.keys(features)) features[k] = features[k].trim();

    return features;
  }

  analyzeWord(word, options = {}) {

    // check the cache first
    let result = this.RiTa.CACHING && this.cache[word];
    if (result === undefined) {

      const slash = '/';
      const delim = '-';
      const lex = this.RiTa.lexicon
      let phones = word;
      let syllables = word;
      let stresses = word;
      const rawPhones = lex.rawPhones(word, { noLts: true })
        || this._computeRawPhones(word, lex, options);

      if (rawPhones) {

        // compute phones, syllables and stresses
        if (typeof rawPhones === 'string') {
          const sp = rawPhones.replaceAll('1', E).replaceAll(' ', delim) + SP;
          phones = (sp === 'dh ') ? 'dh-ah ' : sp; // special case
          const ss = rawPhones.replaceAll(' ', slash).replaceAll('1', E) + SP;
          syllables = (ss === 'dh ') ? 'dh-ah ' : ss;
          stresses = this.phonesToStress(rawPhones);
        }
        else {
          // hyphenated #HWF
          const ps = [];
          const syls = [];
          const strs = [];
          for (const p of rawPhones) {
            const sp = p.replaceAll('1', E).replaceAll(' ', delim);
            ps.push((sp === 'dh ') ? 'dh-ah ' : sp); // special case
            const ss = p.replaceAll(' ', slash).replaceAll('1', E);
            syls.push((ss === 'dh ') ? 'dh-ah ' : ss);
            strs.push(this.phonesToStress(p));
          }
          phones = ps.join("-");
          syllables = syls.join("/");
          stresses = strs.join("-");
          // end of #HWF
        }
      }

      result = { phones, stresses, syllables };
      for (const k of Object.keys(result)) result[k] = result[k].trim();

      // add to cache if enabled
      if (this.RiTa.CACHING) this.cache[word] = result;
    }

    return result;
  }

  computePhones(word, options) {
    this.lts = this.lts || new LetterToSound(this.RiTa);
    return this.lts.buildPhones(word, options);
  }

  phonesToStress(phones) {
    if (!phones) return;
    let stress = E;
    const syls = phones.split(SP);
    for (let index = 0; index < syls.length; index++) {
      if (syls[index].length === 0) continue;
      stress += syls[index].includes('1') ? '1' : '0';
      if (index < syls.length - 1) stress += '/';
    }
    return stress;
  }
}

const HAS_LETTER_RE = /[a-zA-Z]+/;

export default Analyzer;