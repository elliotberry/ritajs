import Util from "./util.js";
import LetterToSound from "./rita_lts.js";

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

  analyze(text, opts) {
    const words = this.RiTa.tokenizer.tokenize(text);
    const tags = this.RiTa.pos(text, opts); // tags are not cached
    const features = {
      phones: E,
      stresses: E,
      syllables: E,
      pos: tags.join(SP),
      tokens: words.join(SP)
    }

    for (let i = 0; i < words.length; i++) {
      let { phones, stresses, syllables } = this.analyzeWord(words[i], opts);
      features.phones += SP + phones;
      features.stresses += SP + stresses;
      features.syllables += SP + syllables;
    }
    Object.keys(features).forEach(k => features[k] = features[k].trim());

    return features;
  }

  computePhones(word, opts) {
    this.lts = this.lts || new LetterToSound(this.RiTa);
    return this.lts.buildPhones(word, opts);
  }

  phonesToStress(phones) {
    if (!phones) return;
    let stress = E;
    const syls = phones.split(SP);
    for (let j = 0; j < syls.length; j++) {
      if (!syls[j].length) continue;
      stress += syls[j].includes('1') ? '1' : '0';
      if (j < syls.length - 1) stress += '/';
    }
    return stress;
  }

  analyzeWord(word, opts = {}) {

    // check the cache first
    let result = this.RiTa.CACHING && this.cache[word];
    if (typeof result === 'undefined') {

      const slash = '/';
      const delim = '-';
      const lex = this.RiTa.lexicon
      let phones = word;
      let syllables = word;
      let stresses = word;
      const rawPhones = lex.rawPhones(word, { noLts: true })
        || this._computeRawPhones(word, lex, opts);

      if (rawPhones) {

        // compute phones, syllables and stresses
        if (typeof rawPhones === 'string') {
          const sp = rawPhones.replace(/1/g, E).replace(/ /g, delim) + SP;
          phones = (sp === 'dh ') ? 'dh-ah ' : sp; // special case
          const ss = rawPhones.replace(/ /g, slash).replace(/1/g, E) + SP;
          syllables = (ss === 'dh ') ? 'dh-ah ' : ss;
          stresses = this.phonesToStress(rawPhones);
        }
        else {
          // hyphenated #HWF
          const ps = [];
          const syls = [];
          const strs = [];
          rawPhones.forEach(p => {
            const sp = p.replace(/1/g, E).replace(/ /g, delim);
            ps.push((sp === 'dh ') ? 'dh-ah ' : sp); // special case
            const ss = p.replace(/ /g, slash).replace(/1/g, E);
            syls.push((ss === 'dh ') ? 'dh-ah ' : ss);
            strs.push(this.phonesToStress(p));
          });
          phones = ps.join("-");
          syllables = syls.join("/");
          stresses = strs.join("-");
          // end of #HWF
        }
      }

      result = { phones, stresses, syllables };
      Object.keys(result).forEach(k => result[k] = result[k].trim());

      // add to cache if enabled
      if (this.RiTa.CACHING) this.cache[word] = result;
    }

    return result;
  }

  _computeRawPhones(word, lex, opts) {
    return word.includes("-")  // #HWF
      ? this._computePhonesHyph(word, lex, opts)
      : this._computePhonesWord(word, lex, opts);
  }

  //#HWF
  _computePhonesHyph(word, lex, opts) {
    const rawPhones = [];
    word.split("-").forEach(p => {
      const part = this._computePhonesWord(p, lex, opts, true);
      if (part && part.length > 0) rawPhones.push(part);
    });
    return rawPhones;
  }

  //#HWF this part is unchanged but move to a separated function
  _computePhonesWord(word, lex, opts, isPart) {
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
    const silent = RiTa.SILENT || RiTa.SILENCE_LTS || (opts && opts.silent);

    // if no phones yet, try the lts-engine
    if (!rawPhones) {
      const ltsPhones = this.computePhones(word, opts);
      if (ltsPhones && ltsPhones.length) {
        if (!silent && lex.size()) {// && word.match(HAS_LETTER_RE)) {
          console.log(`[RiTa] Used LTS-rules for '${word}'`);
        }
        return Util.syllablesFromPhones(ltsPhones);
      }
    }

    return rawPhones;
  }
}

const HAS_LETTER_RE = /[a-zA-Z]+/;

export default Analyzer;