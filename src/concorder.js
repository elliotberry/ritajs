/**
 * @class Concorder
 * @memberof module:rita
 */
class Concorder {

  constructor(parent) {
    this.RiTa = parent;
  }

  concordance(text, options) {
    
    this.words = Array.isArray(text) ? text : this.RiTa.tokenize(text);
    this.ignoreCase = options && options.ignoreCase || false;
    this.ignoreStopWords = options && options.ignoreStopWords || false;
    this.ignorePunctuation = options && options.ignorePunctuation || false;
    this.wordsToIgnore = options && options.wordsToIgnore || [];
    
    this._buildModel();
    
    const result = {};
    for (const name in this.model) {
      result[name] = this.model[name].indexes.length;
    }
    return result; // TODO: sort by value here?
  }

  kwic(word, opts) { // opts can be an options object or an integer

    let numWords = 6;
    if (typeof opts === 'object') { 
      numWords = opts.numWords;
      //text = opts['text'];
      if (opts.text && opts.text.length) this.concordance(opts.text, opts);
      if (opts.words && opts.words.length) this.concordance(opts.words, opts); 
    }
    else if (typeof opts ==='number') {
      numWords = opts;
    }

    if (typeof numWords !== 'number') numWords = 6;  

    if (!this.model) throw Error('Call concordance() first');
    
    const result = [];
    const value = this._lookup(word);
    if (value) {
      const idxs = value.indexes;
      for (let i = 0; i < idxs.length; i++) {
        const sub = this.words.slice(Math.max(0, idxs[i] - numWords),
          Math.min(this.words.length, idxs[i] + numWords + 1));
        if (i < 1 || (idxs[i] - idxs[i - 1]) > numWords) {
          result.push(this.RiTa.untokenize(sub));
        }
      }
    }
    return result;
  }

  count(word) {
    const value = this._lookup(word);
    return value && value.indexes ? value.indexes.length : 0;
  }

  ///////////////////////////////////////////////////////////////////////////

  _buildModel() {
    if (!this.words || this.words.length == 0) throw Error('No text in model'); 
    this.model = {};
    for (let j = 0; j < this.words.length; j++) {
      const word = this.words[j];
      if (this._isIgnorable(word)) continue;
      let _lookup = this._lookup(word);
      // The typeof check below fixes a strange bug in Firefox: #XYZ
      // where the string 'watch' comes back from _lookup as a function
      // TODO: resolve in a better way
      if (!_lookup || typeof _lookup !== 'object') {
        _lookup = { word, key: this._compareKey(word), indexes: [] };
        this.model[_lookup.key] = _lookup;
      }
      _lookup.indexes.push(j);
    }
  }

  _isIgnorable(key) {
    if ((this.ignorePunctuation && this.RiTa.isPunct(key)) || 
      (this.ignoreStopWords && this.RiTa.isStopWord(key))) return true;
    for (let i = 0; i < this.wordsToIgnore.length; i++) {
      const word = this.wordsToIgnore[i];
      if (key === word || (this.ignoreCase && key.toUpperCase() === word.toUpperCase())) {
        return true;
      }
    }
  }

  _compareKey(word) {
    return this.ignoreCase ? word.toLowerCase() : word;
  }

  _lookup(word) {
    const key = this._compareKey(word);
    return this.model[key];
  }
}

export default Concorder;