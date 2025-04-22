import { parse, stringify } from "@ungap/structured-clone/json"

/**
 * See full set of options for RiMarkov (https://rednoise.org/rita/reference/RiTa/markov/index.html)
 * and RiMarkov.generate (https://rednoise.org/rita/reference/RiMarkov/generate/index.html)
 *
 * @class RiMarkov
 * @memberof module:rita
 */
class RiMarkov {
  static parent // RiTa

  /**
   * Creates a new RiMarkov object with functions for text-generation and other probabilistic functions,
   * via Markov chains (or n-grams) with options to process words or tokens split by arbitrary regular expressions.
   * @param {number} [n] - the n-gram size (an integer >= 2)
   * @param {object} [options={}] - options for the model
   * @param {string|string[]} [options.text] - a text string, or array of sentences, to add to the model (same as via model.addText()
   * @param {boolean} [options.trace] - output trace info to the console
   * @param {number} [options.maxLengthMatch] - # of words allowed in result to match a sequence in the input, default=∞
   * @param {number} [options.maxAttempts=999] - max attempts before to complete one ore more generations before erroring, default=999
   * @param {object} [options.tokenize] - custom tokenize() function, defaults to RiTa.tokenize()
   * @param {function} [options.untokenize] - custom untokenize() function, defaults to RiTa.untokenize()
   * @param {boolean} [options.disableInputChecks=false] - if true, allow result to be present in the input, default
   * @memberof RiMarkov
   */
  constructor(n, options = {}) {
    this.n = n
    this.root = new Node(null, "ROOT")

    this.trace = options.trace
    this.mlm = options.maxLengthMatch
    this.maxAttempts = options.maxAttempts || 999
    this.tokenize = options.tokenize || RiMarkov.parent.tokenize
    this.untokenize = options.untokenize || RiMarkov.parent.untokenize
    this.disableInputChecks = options.disableInputChecks
    this.sentenceStarts = [] // allow duplicates for prob

    /** @type {Set<string>} */ this.sentenceEnds = new Set() // no dups

    if (this.n < 2) throw new Error("minimum N is 2")

    if (this.mlm && this.mlm < this.n)
      throw new Error("maxLengthMatch must be >= N")

    // we store inputs to verify we don't duplicate sentences
    if (!this.disableInputChecks || this.mlm) this.input = []

    // add text if supplied as opt //
    if (options.text) this.addText(options.text)
  }

  /**
   * Creates a new model from one previously saved as JSON
   * @param {string} json - the JSON string to load
   * @return {RiMarkov} - the RiMarkov instance
   */
  static fromJSON(json) {
    // parse the json and merge with new object
    const parsed = parse(json)
    const rm = Object.assign(new RiMarkov(), parsed)

    // convert our json array back to a set
    rm.sentenceEnds = new Set(...parsed.sentenceEnds)

    // handle json converting undefined [] to empty []
    if (!parsed.input) rm.input = undefined

    // then recreate the n-gram tree with Node objects
    const jsonRoot = rm.root
    populate((rm.root = new Node(null, "ROOT")), jsonRoot)

    return rm
  }

  /* create a sentence string from an array of nodes */
  _flatten(nodes) {
    if (!nodes || (Array.isArray(nodes) && nodes.length === 0)) return ""
    if (nodes.token) return nodes.token // single-node
    const array = nodes.map((n) => (n ? n.token : "[undef]"))
    const sent = this.untokenize(array)
    return sent.replaceAll(MULTI_SP_RE, " ")
  }

  /*
   * Returns true if node (or string) is a sentence end
   */
  _isEnd(node) {
    if (node) {
      let check = node
      if ("token" in node) check = node.token // needed?
      return this.sentenceEnds.has(check)
    }
    return false
  }

  /*
   * Follows 'path' (using only the last n-1 tokens) from root and returns
   * the node for the last element if it exists, otherwise undefined
   * @param  {Node[]} path
   * @param  {node} root of tree to search
   * @return {node} or undefined
   */
  _pathTo(path, root) {
    root = root || this.root
    if (typeof path === "string") path = [path]
    if (!path || path.length === 0 || this.n < 2) return root
    let index = Math.max(0, path.length - (this.n - 1))
    let node = root.child(path[index++])
    for (let index_ = index; index_ < path.length; index_++) {
      if (node) node = node.child(path[index_])
    }
    return node // can be undefined
  }

  // selects child based on temp, filter and probability (throws)
  _selectNext(parent, temporary, tokens, filter) {
    if (!parent) throw new Error(`no parent:${this._flatten(tokens)}`)

    const children = parent.childNodes({ filter })
    if (children.length === 0) {
      if (this.trace)
        console.log(
          `No children to select, parent=${parent.token}` +
            " children=ok[], all=[" +
            parent.childNodes().map((t) => t.token) +
            "]"
        )
      return
    }

    // basic case: just prob. select from children
    if (!this.mlm || this.mlm > tokens.length) {
      return parent.pselect(filter)
    }

    const validateMlms = (word, nodes) => {
      const check = nodes.slice(-this.mlm).map((n) => n.token)
      check.push(word.token)
      return !isSubArray(check, this.input)
    }

    const rand = RiMarkov.parent.randomizer
    const weights = children.map((n) => n.count)
    const pdist = rand.ndist(weights, temporary)
    const tries = children.length * 2
    const selector = rand.random()

    // loop 2x here as we may skip earlier nodes
    // but keep track of tries to avoid duplicates
    const tried = []
    for (let index = 0, pTotal = 0; index < tries; index++) {
      const index_ = index % children.length
      pTotal += pdist[index_]
      const next = children[index_]
      if (selector < pTotal && !tried.includes(next.token)) {
        tried.push(next.token)
        return validateMlms(next, tokens) ? next : false
      }
    }
  }

  /*
   * Split string of sentences on sentence-ends, keeping delims
   * hack: there _must_ be a better way to do thisn
   */
  _splitEnds(string_) {
    const se = [...this.sentenceEnds]
    const re =
      "(" +
      se
        .reduce((accumulator, w) => `${accumulator + w}|`, "")
        .slice(0, -1)
        .replaceAll(/[.*+?^${}()[\]\\]/g, String.raw`\$&`) +
      ")"
    const array = []
    const parts = string_.split(new RegExp(re, "g"))
    for (const [index, part] of parts.entries()) {
      if (part.length === 0) continue
      if (index % 2 === 0) {
        array.push(part)
      } else {
        array[array.length - 1] += part
      }
    }
    return array.map((a) => a.trim())
  }

  /**
   * Loads text into the model. If a raw string is provided, it will be split into sentences
   * via RiTa.sentences(). If an array is provided, each string will be treated as an individual sentence.
   * @param {string|string[]} text - a text string, or array of sentences, to add to the model
   * @param {number} [multiplier=1] - number of times to add the text to the model
   * @return {RiMarkov} - the RiMarkov instance
   */
  addText(text, multiplier = 1) {
    const sents = Array.isArray(text) ? text : RiMarkov.parent.sentences(text)

    // add new tokens for each sentence start/end
    const allWords = []
    for (let k = 0; k < multiplier; k++) {
      for (const sent of sents) {
        const words = this.tokenize(sent)
        this.sentenceStarts.push(words[0])
        this.sentenceEnds.add(words.at(-1))
        allWords.push(...words)
      }
      this.treeify(allWords)
    }

    if (!this.disableInputChecks || this.mlm) {
      for (const allWord of allWords) {
        this.input.push(allWord)
      }
    }
    return this
  }

  /**
   * Returns array of possible tokens after pre and (optionally) before post. If only one array parameter is provided, this function returns all possible next words, ordered by probability, for the given array.
   * If two arrays are provided, it returns an unordered list of possible words w that complete the n-gram consisting of: pre[0]...pre[k], w, post[k+1]...post[n].
   * @param {string[]} pre - the list of tokens preceding the completion
   * @param {string[]} [post] - the (optional) list of tokens following the completion
   * @return {string[]} - an unordered list of possible next tokens
   */
  completions(pre, post) {
    let tn
    const result = []
    if (post) {
      // fill the center
      if (pre.length + post.length > this.n)
        throw new Error(
          `Sum of pre.length && post.length must be <= N, was ${pre.length + post.length}`
        )
      if (!(tn = this._pathTo(pre))) {
        if (!RiMarkov.parent.SILENT)
          console.warn(`Unable to find nodes in pre: ${pre}`)
        return
      }
      const nexts = tn.childNodes()
      for (const next of nexts) {
        const atest = [...pre]
        atest.push(next.token, ...post)
        if (this._pathTo(atest)) {
          result.push(next.token)
        }
      }
    } else {
      // fill the end
      const pr = this.probabilities(pre)
      return Object.keys(pr).sort((a, b) => pr[b] - pr[a])
    }
    return result
  }

  /**
   * @overload
   * @param {number} count
   * @param {object} [options={}] - options for the generation
   * @param {number} [options.minLength=5] - minimum length of each sentence
   * @param {number} [options.maxLength=35] - maximum length of each sentence
   * @param {number} [options.temperature=1] - temperature acts as a knob to adjust the probability that input elements will be selected for the output. At higher values, infrequent words are more likely to be chosen, while at lower values the most frequent inputs are more likely to be output. If no value is provided, then tokens are chosen according to their relative frequency in the input.
   * @param {boolean} [options.allowDuplicates=false] - if true, allow duplicate sentences in the output
   * @param {string|string[]} [options.seed] - a seed string or array of tokens to start the generation
   * @returns {string[]}
   *
   * @overload
   * @param {object} [options={}] - options for the generation
   * @param {number} [options.minLength=5] - minimum length of each sentence
   * @param {number} [options.maxLength=35] - maximum length of each sentence
   * @param {number} [options.temperature=1] - temperature acts as a knob to adjust the probability that input elements will be selected for the output. At higher values, infrequent words are more likely to be chosen, while at lower values the most frequent inputs are more likely to be output. If no value is provided, then tokens are chosen according to their relative frequency in the input.
   * @param {boolean} [options.allowDuplicates=false] - if true, allow duplicate sentences in the output
   * @param {string|string[]} [options.seed] - a seed string or array of tokens to start the generation
   * @returns {string}
   */
  generate(count, options = {}) {
    let returnsArray = false
    if (typeof count === "number") {
      if (count === 1) {
        throw new Error("For one result, use generate() with no 'count' argument")
      }
      returnsArray = true
    }

    if (arguments.length === 1 && typeof count === "object") {
      options = count
      count = 1
    }

    const number_ = count || 1
    const minLength = options.minLength || 5
    const maxLength = options.maxLength || 35

    if (
      options.temperature !== undefined &&
      options.temperature <= 0
    ) {
      throw new Error("Temperature option must be greater than 0")
    }

    let tries = 0
    const tokens = [] //, usedStarts = [];
    const minIndex = 0
    let sentenceIdxs = []
    const markedNodes = []

    ////////////////////////// local functions /////////////////////////////

    const unmarkNodes = () => {
      for (const n of markedNodes) (n.marked = false)
    }

    const resultCount = () => {
      return tokens.filter((t) => this._isEnd(t)).length
    }

    const markNode = (node) => {
      if (node) {
        // save current tokens as a sort of hash of current state
        node.marked = tokens.reduce((accumulator, e) => accumulator + e.token, "")
        markedNodes.push(node)
      }
    }

    const notMarked = (cn) => {
      const tmap = tokens.reduce((accumulator, e) => accumulator + e.token, "")
      return cn.marked !== tmap
    }

    const validateSentence = (next) => {
      markNode(next)
      const sentIndex = sentenceIndex()

      if (this.trace)
        console.log(
          1 + (tokens.length - sentIndex),
          next.token,
          "[" +
            next.parent
              .childNodes()
              .filter((t) => t !== next)
              .map((t) => t.token) +
            "]"
        ) // print each child

      const sentence = tokens.slice(sentIndex).map((t) => t.token)
      sentence.push(next.token)

      if (sentence.length < minLength) {
        fail(`too-short (pop: ${next.token})`)
        //console.log('pop: ' + next.token);
        return false
      }

      if (!this.disableInputChecks && isSubArray(sentence, this.input)) {
        fail(`in-input (pop: ${next.token})`)
        return false
      }

      const flatSent = this.untokenize(sentence)
      if (
        !options.allowDuplicates &&
        isSubArray(sentence, tokens.slice(0, sentIndex))
      ) {
        fail(`duplicate (pop: ${next.token})`)
        return false
      }

      tokens.push(next)
      sentenceIdxs.push(tokens.length)

      if (this.trace)
        console.log(
          `OK (${resultCount()}/${number_}) "` +
            flatSent +
            '" sidxs=[' +
            sentenceIdxs +
            "]\n"
        )

      return true
    }

    const fail = (message, sentence, forceBacktrack) => {
      tries++
      const sentIndex = sentenceIndex()
      sentence = sentence || this._flatten(tokens.slice(sentIndex))
      if (tries >= this.maxAttempts) throwError(tries, resultCount())
      //if (tokens.length >= this.maxAttempts) throwError(tries, resultCount()); // ???
      const parent = this._pathTo(tokens)
      const numberChildren =
        parent ? parent.childNodes({ filter: notMarked }).length : 0

      if (this.trace)
        console.log(
          "Fail:",
          message,
          `\n  -> "${sentence}"`,
          `${tries} tries, ${resultCount()} successes, numChildren=${numberChildren}` +
            (forceBacktrack ? " forceBacktrack*" : (
              ` parent="${parent.token}` +
              '" goodKids=[' +
              parent.childNodes({ filter: notMarked }).map((t) => t.token) +
              "]" +
              '" allKids=[' +
              parent.childNodes().map((t) => t.token) +
              "]"
            ))
        )

      if (forceBacktrack || numberChildren === 0) {
        backtrack()
      }
    }

    // step back until we have a parent with children
    // or we have reached our start
    // if we find an option, return true
    const backtrack = () => {
      let parent
      let tc
      for (let index = 0; index < 99; index++) {
        // tmp-remove?
        const last = tokens.pop()
        markNode(last)

        if (this._isEnd(last)) sentenceIdxs.pop()

        let sentIndex = sentenceIndex()
        const backtrackUntil = Math.max(sentIndex, minIndex)

        if (this.trace)
          console.log(
            `backtrack#${tokens.length}`,
            `pop "${last.token}" ${tokens.length - sentIndex}` +
              "/" +
              backtrackUntil +
              " " +
              this._flatten(tokens)
          )

        parent = this._pathTo(tokens)
        tc = parent.childNodes({ filter: notMarked })

        if (tokens.length <= backtrackUntil) {
          if (minIndex > 0) {
            // have seed
            if (tokens.length <= minIndex) {
              // back at seed
              if (tc.length === 0) throw new Error("back at barren-seed1: case 0")
              if (this.trace) console.log("case 1")
              return true
            }
            if (tc.length > 0) {
              // continue
              if (this.trace) console.log("case 3")
            } else {
              if (this.trace)
                console.log(
                  'case 2: back at SENT-START: "' +
                    this._flatten(tokens) +
                    '" sentenceIdxs=' +
                    sentenceIdxs +
                    " ok=[" +
                    parent
                      .childNodes({ filter: notMarked })
                      .map((t) => t.token) +
                    "] all=[" +
                    parent.childNodes().map((t) => t.token) +
                    "]"
                )
              sentenceIdxs.pop()
            }
          } else {
            // TODO: recheck

            if (this.trace)
              console.log(
                "case 4: back at start of sentence" + " or 0: " + tokens.length,
                sentenceIdxs
              )

            if (tokens.length === 0) {
              sentenceIdxs = []
              return selectStart()
            }
          }

          return true
        }

        if (tc.length > 0) {
          sentIndex = sentenceIndex()

          if (this.trace)
            console.log(
              tokens.length -
                sentIndex +
                " " +
                this._flatten(tokens) +
                "\n  ok=[" +
                tc.map((t) => t.token) +
                "] all=[" +
                parent.childNodes({ filter: notMarked }).map((t) => t.token) +
                "]"
            )

          return parent
        }
      }

      throw new Error(
        "Invalid state in backtrack() [" + tokens.map((t) => t.token) + "]"
      )
    }

    const sentenceIndex = () => {
      const length = sentenceIdxs.length
      return length ? sentenceIdxs[length - 1] : 0
    }

    const selectStart = () => {
      let seed = options.seed

      if (seed && seed.length > 0) {
        if (typeof seed === "string") seed = this.tokenize(seed)
        let node = this._pathTo(seed, this.root)
        while (!node.isRoot()) {
          tokens.unshift(node)
          node = node.parent
        }
        return
      }

      // we need a new sentence-start
      if (tokens.length === 0 || this._isEnd(tokens.at(-1))) {
        let usableStarts = this.sentenceStarts.filter((ss) =>
          notMarked(this.root.child(ss))
        )
        if (usableStarts.length === 0)
          throw new Error("No valid sentence-starts remaining")
        const start = RiMarkov.parent.random(usableStarts)
        const startTok = this.root.child(start)
        markNode(startTok)
        usableStarts = this.sentenceStarts.filter((ss) =>
          notMarked(this.root.child(ss))
        )
        tokens.push(startTok)
        return
      }
      throw new Error(`Invalid call to selectStart: ${this._flatten(tokens)}`)
    }

    ////////////////////////////////// code ////////////////////////////////////////

    selectStart()

    while (resultCount() < number_) {
      const sentIndex = sentenceIndex()

      if (tokens.length - sentIndex >= maxLength) {
        fail("too-long", 0, true)
        continue
      }

      const parent = this._pathTo(tokens)
      const next = this._selectNext(
        parent,
        options.temperature,
        tokens,
        notMarked
      )

      if (!next) {
        // no valid children, pop and continue;
        fail(`mlm-fail(${this.mlm})`, this._flatten(tokens), true)
        continue
      }

      if (this._isEnd(next)) {
        validateSentence(next)
        continue
      }

      tokens.push(next)

      if (this.trace)
        console.log(
          tokens.length - sentIndex,
          next.token,
          "[" +
            parent
              .childNodes({ filter: notMarked }) // print unmarked kids
              .filter((t) => t !== next)
              .map((t) => t.token) +
            "]"
        )
    }

    unmarkNodes()

    const string_ = this.untokenize(tokens.map((t) => t.token)).trim()
    return returnsArray ? this._splitEnds(string_) : string_
  }

  ////////////////////////////// end API ////////////////////////////////

  /**
   * Returns the full set of possible next tokens as a object, mapping tokens to probabilities,
   *  given an array of tokens representing the path down the tree (with length less than `n`).
   * @param {string|string[]} path - the path to the node as a string or an array of tokens
   * @param {number} [temperature=1] - temperature acts as a knob to adjust the probability that input elements will be selected for the output. At higher values, infrequent words are more likely to be chosen, while at lower values the most frequent inputs are more likely to be output. If no value is provided, then tokens are chosen according to their relative frequency in the input.
   * @return {object} - a map of tokens to probabilities
   */
  probabilities(path, temperature) {
    if (!Array.isArray(path)) path = this.tokenize(path)
    const probs = {}
    const parent = this._pathTo(path)
    if (parent) {
      const children = parent.childNodes()
      const weights = children.map((n) => n.count)
      const pdist = RiMarkov.parent.randomizer.ndist(weights, temperature)
      for (const [index, c] of children.entries()) (probs[c.token] = pdist[index])
    }
    return probs
  }

  /**
   * Returns either the raw (unigram) probability for a single token in the model (0 if it does not exist), OR
   * the probability of a sequence of K tokens where K is less than `n` (0 if the sequence does not exist).
   * @param {string|string[]} data - the token or array of tokens to check
   * @return {number} - the probability of the token or sequence
   */
  probability(data) {
    if (data && data.length > 0) {
      const tn =
        typeof data === "string" ? this.root.child(data) : this._pathTo(data)
      if (tn) return tn.nodeProb(true) // no meta
    }
    return 0
  }

  /**
   * Returns the number of tokens currently in the model.
   * @return {number} - number of tokens
   */
  size() {
    return this.root.childCount(true)
  }

  /**
   * Converts the model to a JSON-formatted string for storage or serialization
   * @return {string} - the JSON string
   */
  toJSON() {
    const data = Object.fromEntries(Object.keys(this).map(
      ( k) => [k, this[k]]
    ))
    // @ts-ignore
    data.sentenceEnds = [...data.sentenceEnds] // set -> []
    return stringify(data)
  }

  /**
   * Returns a string representation of the model or a subtree of the model, optionally ordered by probability.
   * @param {object} root - the root node of the subtree to print
   * @param {boolean} sort - if true, sort the nodes by probability
   * @return {string} - the string representation of the model
   */
  toString(root, sort) {
    root = root || this.root
    return root.asTree(sort).replaceAll('{}', "")
  }

  /* add tokens to tree */
  treeify(tokens) {
    const root = this.root
    for (let index = 0; index < tokens.length; index++) {
      let node = root
      const words = tokens.slice(index, index + this.n)
      let wrap = 0
      for (let index = 0; index < this.n; index++) {
        let hidden = false
        if (index >= words.length) {
          words[index] = tokens[wrap++]
          hidden = true
        }
        node = node.addChild(words[index])
        if (hidden) node.hidden = true
      }
    }
  }
}

/**  @memberof module:rita */
class Node {
  constructor(parent, word, count) {
    this.children = {}
    this.parent = parent
    this.token = word
    this.count = count || 0
    this.numChildren = -1 // for cache
    this.marked = false
    this.hidden = false // hidden
  }

  // Increments count for a child node and returns it
  addChild(word, count) {
    this.numChildren = -1 // invalidate cache
    count = count || 1
    let node = this.children[word]
    if (!node) {
      node = new Node(this, word)
      this.children[word] = node
    }
    node.count += count
    return node
  }

  asTree(sort, showHiddenNodes) {
    let s = `${this.token} `
    if (this.parent) s += `(${this.count})->`
    s += "{"
    return this.childCount(true) ?
        stringulate(this, s, 1, sort, !showHiddenNodes)
      : `${s}}`
  }

  // Find a (direct) child node with matching token, given a word or node
  child(word) {
    let lookup = word
    if (word.token) lookup = word.token
    return this.children[lookup]
  }

  childCount(ignoreHidden) {
    if (this.numChildren === -1) {
      const options = {}
      if (ignoreHidden) options.filter = (t) => !t.hidden
      this.numChildren = this.childNodes(options).reduce((a, c) => a + c.count, 0)
    }
    return this.numChildren
  }

  childNodes(options) {
    const sort = options && options.sort
    const filter = options && options.filter
    let kids = Object.values(this.children)
    if (filter) kids = kids.filter(filter)
    if (sort)
      kids.sort((a, b) =>
        b.count === a.count ? b.token.localeCompare(a.token) : b.count - a.count
      )
    return kids
  }

  isLeaf(ignoreHidden) {
    return this.childCount(ignoreHidden) < 1
  }

  isRoot() {
    return !this.parent
  }

  nodeProb(excludeMetaTags) {
    if (!this.parent) throw new Error("no parent")
    return this.count / this.parent.childCount(excludeMetaTags)
  }

  pselect(filter) {
    const rand = RiMarkov.parent.randomizer
    const children = this.childNodes({ filter })
    if (children.length === 0) {
      throw new Error(
        `No eligible child for "${this.token}` +
          '" children=[' +
          this.childNodes().map((t) => t.token) +
          "]"
      )
    }
    const weights = children.map((n) => n.count)
    const pdist = rand.ndist(weights)
    const index = rand.pselect(pdist)
    return children[index]
  }

  toString() {
    return this.parent ?
        `'${this.token}' [${this.count}` +
          ",p=" +
          this.nodeProb().toFixed(3) +
          "]"
      : "Root"
  }
}

// --------------------------------------------------------------

function stringulate(mn, string_, depth, sort, ignoreHidden) {
  sort = sort || false
  let indent = "\n"
  const l = mn.childNodes({ filter: (t) => !t.hidden, sort: true })
  if (l.length === 0) return string_
  for (let index = 0; index < depth; index++) indent += "  "
  for (const node of l) {
    if (node && node.token) {
      string_ += `${indent}'${encode(node.token)}'`
      if (!node.isRoot())
        string_ += ` [${node.count}` + ",p=" + node.nodeProb().toFixed(3) + "]"
      if (!node.isLeaf(ignoreHidden)) {
        //console.log('appending "{" for '+node.token, node.childNodes());
        string_ += "  {"
      }
      string_ =
        mn.childCount(ignoreHidden) ?
          stringulate(node, string_, depth + 1, sort)
        : `${string_}}`
    }
  }
  indent = "\n"
  for (let index = 0; index < depth - 1; index++) indent += "  "
  return `${string_ + indent}}`
}

function encode(tok) {
  if (tok === "\n") tok = String.raw`\n`
  if (tok === "\r") tok = String.raw`\r`
  if (tok === "\t") tok = String.raw`\t`
  if (tok === "\r\n") return String.raw`\r\n`
  return tok
}

function populate(objectNode, jsonNode) {
  if (!jsonNode) return
  const children = Object.values(jsonNode.children)
  for (const child of children) {
    const newNode = objectNode.addChild(child.token, child.count)
    populate(newNode, child) // recurse
  }
}

function throwError(tries, oks) {
  throw new Error(
    `Failed after ${tries} tries` +
      (oks ? ` and ${oks} successes` : "") +
      ", you may need to adjust options or add more text"
  )
}

function isSubArray(find, array) {
  if (!array || array.length === 0) return false
  OUT: for (let index = find.length - 1; index < array.length; index++) {
    for (let index_ = 0; index_ < find.length; index_++) {
      if (find[find.length - index_ - 1] !== array[index - index_]) continue OUT
      if (index_ === find.length - 1) return true
    }
  }
  return false
}

const MULTI_SP_RE = / +/g

export default RiMarkov
