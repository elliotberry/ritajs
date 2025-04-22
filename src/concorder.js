/**
 * @class Concorder
 * @memberof module:rita
 */
class Concorder {

  constructor(parent) {
    this.RiTa = parent;
  }

  _buildModel() {
    if (!this.words || this.words.length === 0) throw new Error('No text in model'); 
    this.model = {};
    for (let index = 0; index < this.words.length; index++) {
      const word = this.words[index];
      if (this._isIgnorable(word)) continue;
      let _lookup = this._lookup(word);
      // The typeof check below fixes a strange bug in Firefox: #XYZ
      // where the string 'watch' comes back from _lookup as a function
      // TODO: resolve in a better way
      if (!_lookup || typeof _lookup !== 'object') {
        _lookup = { indexes: [], key: this._compareKey(word), word };
        this.model[_lookup.key] = _lookup;
      }
      _lookup.indexes.push(index);
    }
  }

  _compareKey(word) {
    return this.ignoreCase ? word.toLowerCase() : word;
  }

  _isIgnorable(key) {
    if ((this.ignorePunctuation && this.RiTa.isPunct(key)) || 
      (this.ignoreStopWords && this.RiTa.isStopWord(key))) return true;
    for (let index = 0; index < this.wordsToIgnore.length; index++) {
      const word = this.wordsToIgnore[index];
      if (key === word || (this.ignoreCase && key.toUpperCase() === word.toUpperCase())) {
        return true;
      }
    }
  }

  ///////////////////////////////////////////////////////////////////////////

  _lookup(word) {
    const key = this._compareKey(word);
    return this.model[key];
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

  count(word) {
    const value = this._lookup(word);
    return value && value.indexes ? value.indexes.length : 0;
  }

  kwic(word, options) { // opts can be an options object or an integer

    let numberWords = 6;
    if (typeof options === 'object') { 
      numberWords = options.numWords;
      //text = opts['text'];
      if (options.text && options.text.length > 0) this.concordance(options.text, options);
      if (options.words && options.words.length > 0) this.concordance(options.words, options); 
    }
    else if (typeof options ==='number') {
      numberWords = options;
    }

    if (typeof numberWords !== 'number') numberWords = 6;  

    if (!this.model) throw new Error('Call concordance() first');
    
    const result = [];
    const value = this._lookup(word);
    if (value) {
      const idxs = value.indexes;
      for (let index = 0; index < idxs.length; index++) {
        const sub = this.words.slice(Math.max(0, idxs[index] - numberWords),
          Math.min(this.words.length, idxs[index] + numberWords + 1));
        if (index < 1 || (idxs[index] - idxs[index - 1]) > numberWords) {
          result.push(this.RiTa.untokenize(sub));
        }
      }
    }
    return result;
  }
}

export default Concorder;