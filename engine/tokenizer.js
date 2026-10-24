// CloneScope tokenizer
// --------------------
// Turns source code (Python, Java, C, C++) into a *normalized* token stream.
//
//  * comments, whitespace, docstrings, #include / import lines are dropped
//  * user-defined names (variables, functions, classes)  -> ID
//  * number / string / char literals                     -> NUM / STR / CHR
//  * keywords, operators and well-known library names are kept as they are
//  * Python block structure becomes NEWLINE / INDENT / DEDENT tokens
//
// Renaming a variable or rewriting a comment therefore does not change the
// token stream at all - which is exactly what we want for plagiarism checks.
//
// This file is the single source of truth for tokenization: the browser app
// and the Python training pipeline (via Node) both use it, so the model is
// trained on exactly the same tokens it sees in production.

export const VOCAB_VERSION = 1;

export const KIND = {
  FIXED: 0,   // keyword, operator, punctuation
  ID: 1,      // user-defined identifier (normalized to ID)
  NUM: 2,
  STR: 3,
  CHR: 4,
  STRUCT: 5,  // NEWLINE / INDENT / DEDENT
  KNOWN: 6,   // library / builtin name kept verbatim
  UNK: 7,
};

const SPECIAL = ['<pad>', '<unk>', 'ID', 'NUM', 'STR', 'CHR', 'NEWLINE', 'INDENT', 'DEDENT', '#define'];

// ---------------------------------------------------------------- keywords
const PY_KW = ['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class',
  'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if',
  'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
  'while', 'with', 'yield'];

const JAVA_KW = ['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char', 'class',
  'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally',
  'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long',
  'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static',
  'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try',
  'void', 'volatile', 'while', 'true', 'false', 'null', 'var'];

const C_KW = ['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else',
  'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register', 'restrict',
  'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union',
  'unsigned', 'void', 'volatile', 'while', '_Bool', 'bool', 'true', 'false'];

const CPP_KW = [...C_KW, 'alignas', 'alignof', 'asm', 'catch', 'char8_t', 'char16_t', 'char32_t',
  'class', 'concept', 'const_cast', 'consteval', 'constexpr', 'constinit', 'co_await', 'co_return',
  'co_yield', 'decltype', 'delete', 'dynamic_cast', 'explicit', 'export', 'friend', 'mutable',
  'namespace', 'new', 'noexcept', 'nullptr', 'operator', 'private', 'protected', 'public',
  'reinterpret_cast', 'requires', 'static_assert', 'static_cast', 'template', 'this',
  'thread_local', 'throw', 'try', 'typeid', 'typename', 'using', 'virtual', 'wchar_t', 'override',
  'final'];

// C++ alternative operator spellings are mapped onto the normal operators.
const CPP_ALT = { and: '&&', and_eq: '&=', bitand: '&', bitor: '|', compl: '~', not: '!',
  not_eq: '!=', or: '||', or_eq: '|=', xor: '^', xor_eq: '^=' };

// --------------------------------------------------------------- operators
const OPS_COMMON = ['>>=', '<<=', '...', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&',
  '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '::', '+', '-', '*', '/', '%', '=', '<',
  '>', '!', '~', '&', '|', '^', '?', ':', ';', ',', '.', '(', ')', '[', ']', '{', '}', '@', '#',
  '##'];
const OPS = {
  python: ['**=', '//=', '>>=', '<<=', '...', '->', '**', '//', ':=', '<<', '>>', '<=', '>=', '==',
    '!=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=', '+', '-', '*', '/', '%', '@', '&',
    '|', '^', '~', '<', '>', '(', ')', '[', ']', '{', '}', ',', ':', '.', ';', '=', '!'],
  java: ['>>>=', '>>>', ...OPS_COMMON],
  c: [...OPS_COMMON],
  cpp: ['<=>', '->*', '.*', ...OPS_COMMON],
};

// ------------------------------------------------- well-known library names
// ALWAYS: kept verbatim wherever they appear (modules, classes, stream objects).
// CALL:   kept verbatim only when directly called, e.g. `append(`  (so a student
//         variable called `sum` or `max` is still treated as a normal name).
// ATTR:   kept verbatim only after `.` or `::`, e.g. `arr.length`, `System.out`.
const KNOWN = {
  python: {
    always: ['self', 'cls', 'print', 'range', 'len', 'input', 'enumerate', 'zip', 'isinstance',
      'math', 'sys', 'random', 'os', 'collections', 'itertools', 'functools', 'heapq', 'bisect',
      'string', 'time', 'datetime', 're', 'json', 'numpy', 'np', '__name__', '__main__',
      '__init__', '__str__', '__repr__', '__len__', '__eq__', '__lt__', 'Exception', 'ValueError',
      'TypeError', 'IndexError', 'KeyError', 'ZeroDivisionError', 'StopIteration', 'object'],
    call: ['sum', 'max', 'min', 'abs', 'sorted', 'sort', 'append', 'extend', 'pop', 'insert',
      'remove', 'index', 'count', 'split', 'join', 'strip', 'rstrip', 'lstrip', 'lower', 'upper',
      'replace', 'find', 'format', 'keys', 'values', 'items', 'get', 'int', 'str', 'float', 'list',
      'dict', 'set', 'tuple', 'bool', 'map', 'filter', 'reversed', 'round', 'pow', 'divmod', 'ord',
      'chr', 'open', 'read', 'write', 'readline', 'readlines', 'sqrt', 'floor', 'ceil', 'log',
      'randint', 'choice', 'shuffle', 'copy', 'deepcopy', 'add', 'update', 'startswith',
      'endswith', 'isdigit', 'isalpha', 'isalnum', 'isupper', 'islower', 'isspace', 'any', 'all',
      'iter', 'next', 'type', 'super', 'hasattr', 'getattr', 'setattr', 'exit', 'sleep',
      'defaultdict', 'Counter', 'deque', 'heappush', 'heappop', 'heapify', 'bisect_left',
      'bisect_right', 'reverse', 'clear', 'setdefault', 'popleft', 'appendleft', 'hex', 'bin',
      'oct', 'gcd', 'factorial', 'permutations', 'combinations', 'product', 'title',
      'capitalize', 'zfill', 'center', 'ljust', 'rjust', 'isnumeric', 'swapcase', 'id', 'hash',
      'vars', 'dir', 'callable', 'repr', 'frozenset', 'bytes', 'complex', 'slice', 'property',
      'staticmethod', 'classmethod', 'random', 'uniform', 'perf_counter', 'array', 'zeros',
      'ones', 'arange', 'dot', 'mean'],
    attr: ['pi', 'e', 'inf', 'argv', 'stdin', 'stdout', 'maxsize', 'path', 'ascii_lowercase',
      'ascii_uppercase', 'digits', 'ascii_letters'],
  },
  java: {
    always: ['System', 'String', 'Scanner', 'Integer', 'Double', 'Float', 'Long', 'Short', 'Byte',
      'Character', 'Boolean', 'Math', 'Arrays', 'ArrayList', 'LinkedList', 'List', 'HashMap',
      'TreeMap', 'Map', 'HashSet', 'TreeSet', 'Set', 'StringBuilder', 'StringBuffer',
      'Collections', 'Exception', 'RuntimeException', 'IOException', 'Object', 'Queue', 'Deque',
      'ArrayDeque', 'Stack', 'Iterator', 'Random', 'BufferedReader', 'InputStreamReader',
      'PriorityQueue', 'Comparator', 'Comparable', 'Thread', 'Runnable', 'Override',
      'IllegalArgumentException', 'ArithmeticException', 'NumberFormatException', 'BigInteger',
      'BigDecimal', 'Optional', 'Stream', 'Collectors', 'IntStream', 'Vector', 'main'],
    call: ['println', 'print', 'printf', 'nextInt', 'nextLine', 'next', 'nextDouble', 'nextLong',
      'nextFloat', 'nextBoolean', 'hasNext', 'hasNextInt', 'hasNextLine', 'length', 'size', 'add',
      'get', 'set', 'put', 'remove', 'contains', 'containsKey', 'containsValue', 'isEmpty',
      'charAt', 'substring', 'indexOf', 'lastIndexOf', 'equals', 'equalsIgnoreCase', 'compareTo',
      'toString', 'valueOf', 'parseInt', 'parseDouble', 'parseLong', 'sqrt', 'pow', 'abs', 'max',
      'min', 'floor', 'ceil', 'round', 'random', 'sort', 'toCharArray', 'split', 'trim',
      'toUpperCase', 'toLowerCase', 'append', 'reverse', 'insert', 'close', 'format', 'keySet',
      'values', 'entrySet', 'getKey', 'getValue', 'push', 'pop', 'peek', 'offer', 'poll',
      'iterator', 'asList', 'fill', 'copyOf', 'readLine', 'clear', 'getOrDefault', 'isDigit',
      'isLetter', 'isUpperCase', 'isLowerCase', 'isWhitespace', 'toUpperCase', 'startsWith',
      'endsWith', 'replace', 'join', 'stream', 'forEach', 'nextGaussian', 'currentTimeMillis',
      'nanoTime', 'exit', 'hashCode', 'getClass', 'getName', 'start', 'run', 'matches', 'concat',
      'addAll', 'subList', 'toArray', 'binarySearch', 'swap', 'arraycopy', 'deleteCharAt',
      'setCharAt', 'intValue', 'doubleValue', 'chars', 'hasNextDouble', 'addFirst', 'addLast',
      'removeFirst', 'removeLast', 'pollFirst', 'pollLast', 'peekFirst', 'peekLast', 'compare'],
    attr: ['out', 'in', 'err', 'length', 'MAX_VALUE', 'MIN_VALUE', 'PI', 'E'],
  },
  c: {
    always: ['printf', 'scanf', 'NULL', 'malloc', 'calloc', 'realloc', 'free', 'strlen', 'strcpy',
      'strncpy', 'strcmp', 'strncmp', 'strcat', 'strncat', 'strchr', 'strstr', 'strrev', 'puts',
      'gets', 'getchar', 'putchar', 'fgets', 'fputs', 'fprintf', 'fscanf', 'sprintf', 'sscanf',
      'fopen', 'fclose', 'fread', 'fwrite', 'memset', 'memcpy', 'memmove', 'exit', 'EOF', 'FILE',
      'stdin', 'stdout', 'stderr', 'size_t', 'main', 'getch', 'clrscr', 'system', 'qsort',
      'atoi', 'atof', 'isdigit', 'isalpha', 'isalnum', 'isupper', 'islower', 'isspace',
      'toupper', 'tolower', 'INT_MAX', 'INT_MIN', 'RAND_MAX', 'uint8_t', 'uint32_t', 'uint64_t',
      'int64_t', 'int32_t'],
    call: ['sqrt', 'pow', 'abs', 'fabs', 'floor', 'ceil', 'rand', 'srand', 'time', 'max', 'min',
      'log', 'log10', 'exp', 'sin', 'cos', 'tan', 'round', 'clock', 'assert'],
    attr: [],
  },
  cpp: {
    always: ['std', 'cout', 'cin', 'cerr', 'endl', 'vector', 'string', 'map', 'set',
      'unordered_map', 'unordered_set', 'multiset', 'multimap', 'pair', 'queue', 'stack', 'deque',
      'priority_queue', 'list', 'array', 'bitset', 'iostream', 'istream', 'ostream', 'ifstream',
      'ofstream', 'stringstream', 'istringstream', 'ostringstream', 'printf', 'scanf', 'NULL',
      'malloc', 'free', 'strlen', 'strcpy', 'strcmp', 'puts', 'getchar', 'putchar', 'memset',
      'memcpy', 'exit', 'size_t', 'main', 'getline', 'make_pair', 'greater', 'less', 'INT_MAX',
      'INT_MIN', 'LLONG_MAX', 'LLONG_MIN', 'numeric_limits', 'shared_ptr', 'unique_ptr',
      'make_shared', 'make_unique', 'function', 'tuple', 'make_tuple', 'exception',
      'runtime_error', 'invalid_argument', 'iterator', 'uint8_t', 'uint32_t', 'uint64_t',
      'int64_t', 'int32_t', 'ios', 'ios_base', 'sync_with_stdio', 'fixed', 'setprecision',
      'setw', 'boolalpha'],
    call: ['sort', 'swap', 'reverse', 'push_back', 'pop_back', 'emplace_back', 'push_front',
      'pop_front', 'begin', 'end', 'rbegin', 'rend', 'size', 'empty', 'insert', 'erase', 'find',
      'count', 'clear', 'resize', 'reserve', 'front', 'back', 'top', 'push', 'pop', 'max', 'min',
      'abs', 'sqrt', 'pow', 'floor', 'ceil', 'fabs', 'rand', 'srand', 'time', 'to_string', 'stoi',
      'stol', 'stoll', 'stod', 'substr', 'length', 'at', 'c_str', 'accumulate', 'max_element',
      'min_element', 'lower_bound', 'upper_bound', 'binary_search', 'fill', 'memset', 'emplace',
      'next_permutation', 'unique', 'distance', 'advance', 'get', 'tie', 'log', 'log2', 'exp',
      'round', 'gcd', 'lcm', 'transform', 'append', 'compare', 'iota', 'assign', 'data',
      'is_open', 'close', 'open', 'what', 'isdigit', 'isalpha', 'toupper', 'tolower', 'assert'],
    attr: ['first', 'second'],
  },
};

// ------------------------------------------------------------ vocabulary
const uniq = (arr) => [...new Set(arr)];
const ALL_KW = uniq([...PY_KW, ...JAVA_KW, ...C_KW, ...CPP_KW]).sort();
const ALL_OPS = uniq([...OPS.python, ...OPS.java, ...OPS.c, ...OPS.cpp]).sort();
const ALL_KNOWN = uniq(Object.values(KNOWN).flatMap((k) => [...k.always, ...k.call, ...k.attr])).sort();

export const VOCAB = uniq([...SPECIAL, ...ALL_KW, ...ALL_OPS, ...ALL_KNOWN]);
const VOCAB_INDEX = new Map(VOCAB.map((t, i) => [t, i]));
export const TOKEN_ID = Object.fromEntries(SPECIAL.map((t) => [t, VOCAB_INDEX.get(t)]));

/** Simple stable hash of the vocabulary (lets the model check it was trained on the same one). */
export function vocabHash() {
  let h = 2166136261;
  const s = VOCAB.join('\u0001');
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16);
}

const KW_SET = { python: new Set(PY_KW), java: new Set(JAVA_KW), c: new Set(C_KW), cpp: new Set(CPP_KW) };
const OPS_SORTED = Object.fromEntries(Object.entries(OPS).map(([l, ops]) => [l, uniq(ops).sort((a, b) => b.length - a.length)]));
const KNOWN_SETS = Object.fromEntries(Object.entries(KNOWN).map(([l, k]) => [l, {
  always: new Set(k.always), call: new Set(k.call), attr: new Set(k.attr),
}]));

// -------------------------------------------------------------- language
const EXT = {
  py: 'python', pyw: 'python', java: 'java', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp',
  'c++': 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp', ino: 'cpp',
};
export const LANGUAGE_NAMES = { python: 'Python', java: 'Java', c: 'C', cpp: 'C++' };

/** Detects language from a file name (and content, for ambiguous .h files). Returns null if unsupported. */
export function detectLanguage(filename, text = '') {
  const m = /\.([^./\\]+)$/.exec(filename || '');
  if (!m) return null;
  const lang = EXT[m[1].toLowerCase()] || null;
  if (lang === 'c' && /\.h$/i.test(filename) && /\b(class|template|namespace|std::)\b/.test(text)) return 'cpp';
  return lang;
}

/** C and C++ are compared with each other; Python and Java only with themselves. */
export function languageFamily(lang) {
  return lang === 'c' || lang === 'cpp' ? 'c/cpp' : lang;
}

// --------------------------------------------------------------- helpers
const isDigit = (c) => c >= '0' && c <= '9';
const isIdStart = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$' || c > '\u007f';
const isIdPart = (c) => isIdStart(c) || isDigit(c);

class Sink {
  constructor(lang) {
    this.lang = lang;
    this.ids = []; this.starts = []; this.ends = []; this.lines = []; this.kinds = [];
    this.comments = [];
  }
  get length() { return this.ids.length; }
  push(tok, start, end, line, kind) {
    let id = VOCAB_INDEX.get(tok);
    if (id === undefined) { id = TOKEN_ID['<unk>']; kind = KIND.UNK; }
    this.ids.push(id); this.starts.push(start); this.ends.push(end); this.lines.push(line); this.kinds.push(kind);
  }
  truncate(n) {
    this.ids.length = n; this.starts.length = n; this.ends.length = n; this.lines.length = n; this.kinds.length = n;
  }
  last() { return this.ids.length ? this.ids[this.ids.length - 1] : -1; }
  finish(text) {
    return {
      lang: this.lang,
      n: this.ids.length,
      ids: Uint16Array.from(this.ids),
      starts: Int32Array.from(this.starts),
      ends: Int32Array.from(this.ends),
      lines: Int32Array.from(this.lines),
      kinds: Uint8Array.from(this.kinds),
      comments: this.comments,
      lineCount: text.length ? text.split('\n').length : 0,
    };
  }
}

function matchOperator(src, i, ops) {
  for (const op of ops) {
    if (src.startsWith(op, i)) return op;
  }
  return null;
}

function nextNonSpace(src, i) {
  while (i < src.length && (src[i] === ' ' || src[i] === '\t')) i++;
  return i < src.length ? src[i] : '';
}

/** Decide how an identifier is emitted: keyword, known library name or ID. */
function emitWord(sink, word, start, end, line, lang, src) {
  if (lang === 'cpp' && CPP_ALT[word]) { sink.push(CPP_ALT[word], start, end, line, KIND.FIXED); return; }
  if (KW_SET[lang].has(word)) { sink.push(word, start, end, line, KIND.FIXED); return; }
  const k = KNOWN_SETS[lang];
  if (k.always.has(word)) { sink.push(word, start, end, line, KIND.KNOWN); return; }
  if (k.call.has(word) && nextNonSpace(src, end) === '(') { sink.push(word, start, end, line, KIND.KNOWN); return; }
  if (k.attr.size && k.attr.has(word)) {
    const prev = sink.last();
    if (prev === VOCAB_INDEX.get('.') || prev === VOCAB_INDEX.get('::') || prev === VOCAB_INDEX.get('->')) {
      sink.push(word, start, end, line, KIND.KNOWN); return;
    }
  }
  sink.push('ID', start, end, line, KIND.ID);
}

// ------------------------------------------------------------ C / C++ / Java
function tokenizeCLike(src, lang) {
  const sink = new Sink(lang);
  const ops = OPS_SORTED[lang];
  const n = src.length;
  let i = 0, line = 1;
  let lineStart = true;     // only whitespace seen so far on this line
  let depth = 0;            // brace depth (Java import skipping)
  let stmtStart = true;     // previous token ended a statement

  const skipLine = () => {  // skip to end of line, honouring backslash continuations
    while (i < n && src[i] !== '\n') {
      if (src[i] === '\\' && src[i + 1] === '\n') { i += 2; line++; continue; }
      if (src[i] === '\\' && src[i + 1] === '\r' && src[i + 2] === '\n') { i += 3; line++; continue; }
      i++;
    }
  };

  while (i < n) {
    const c = src[i];
    if (c === '\n') { i++; line++; lineStart = true; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { i++; continue; }
    if (c === '\\' && (src[i + 1] === '\n' || src[i + 1] === '\r')) { i++; continue; }

    // comments
    if (c === '/' && src[i + 1] === '/') {
      const s = i; skipLine(); sink.comments.push({ start: s, end: i, line }); continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const s = i, l0 = line; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
      i = Math.min(n, i + 2);
      sink.comments.push({ start: s, end: i, line: l0 });
      continue;
    }

    // preprocessor (C / C++)
    if (c === '#' && lineStart && lang !== 'java') {
      let j = i + 1;
      while (j < n && (src[j] === ' ' || src[j] === '\t')) j++;
      let k = j;
      while (k < n && isIdPart(src[k])) k++;
      const directive = src.slice(j, k);
      if (directive === 'define') {
        sink.push('#define', i, k, line, KIND.FIXED);
        i = k; lineStart = false; continue;
      }
      skipLine(); continue;  // #include, #pragma, #ifdef ... carry no program logic
    }
    lineStart = false;

    // identifiers / keywords / literal prefixes
    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdPart(src[j])) j++;
      const word = src.slice(i, j);
      // C/C++ string & char prefixes: L"..", u8"..", R"(..)"
      if (lang !== 'java' && (src[j] === '"' || src[j] === "'") && /^(L|u8|u|U|R|LR|u8R|uR|UR)$/.test(word)) {
        if (word.endsWith('R') && src[j] === '"') {
          // raw string R"delim( ... )delim"
          const open = src.indexOf('(', j);
          const delim = open > 0 ? src.slice(j + 1, open) : '';
          const close = open > 0 ? src.indexOf(')' + delim + '"', open) : -1;
          const e = close < 0 ? n : close + delim.length + 2;
          for (let t = i; t < e; t++) if (src[t] === '\n') line++;
          sink.push('STR', i, e, line, KIND.STR); i = e; stmtStart = false; continue;
        }
        i = j; // fall through to quote handling with the prefix included
        const r = scanQuoted(src, i, src[i]);
        sink.push(src[j] === '"' ? 'STR' : 'CHR', j - word.length, r.end, line, src[j] === '"' ? KIND.STR : KIND.CHR);
        line += r.newlines; i = r.end; stmtStart = false; continue;
      }
      // Java: drop `package ...;` and `import ...;`
      if (lang === 'java' && depth === 0 && stmtStart && (word === 'import' || word === 'package')) {
        while (i < n && src[i] !== ';') { if (src[i] === '\n') line++; i++; }
        i++; continue;
      }
      emitWord(sink, word, i, j, line, lang, src);
      i = j; stmtStart = false; continue;
    }

    // numbers
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      let j = i + 1;
      while (j < n) {
        const d = src[j];
        if (isIdPart(d) || d === '.') { j++; continue; }
        if (d === '+' || d === '-') {
          const sofar = src.slice(i, j);
          const hex = /^0[xX]/.test(sofar);
          if ((!hex && /[eE]$/.test(sofar)) || (hex && /[pP]$/.test(sofar))) { j++; continue; }
        }
        if (d === "'" && lang === 'cpp' && /[0-9a-fA-F]/.test(src[j - 1]) && /[0-9a-fA-F]/.test(src[j + 1] || '')) { j++; continue; }
        break;
      }
      sink.push('NUM', i, j, line, KIND.NUM); i = j; stmtStart = false; continue;
    }

    // strings / chars
    if (c === '"') {
      if (lang === 'java' && src.startsWith('"""', i)) {
        const close = src.indexOf('"""', i + 3);
        const e = close < 0 ? n : close + 3;
        const l0 = line; for (let t = i; t < e; t++) if (src[t] === '\n') line++;
        sink.push('STR', i, e, l0, KIND.STR); i = e; stmtStart = false; continue;
      }
      const r = scanQuoted(src, i, '"');
      sink.push('STR', i, r.end, line, KIND.STR); line += r.newlines; i = r.end; stmtStart = false; continue;
    }
    if (c === "'") {
      const r = scanQuoted(src, i, "'");
      sink.push('CHR', i, r.end, line, KIND.CHR); line += r.newlines; i = r.end; stmtStart = false; continue;
    }

    // operators & punctuation
    const op = matchOperator(src, i, ops);
    if (op) {
      sink.push(op, i, i + op.length, line, KIND.FIXED);
      if (op === '{') depth++;
      else if (op === '}') depth = Math.max(0, depth - 1);
      stmtStart = op === ';' || op === '{' || op === '}';
      i += op.length; continue;
    }
    sink.push('<unk>', i, i + 1, line, KIND.UNK); i++;
  }
  return sink.finish(src);
}

/** Scans a quoted literal starting at i (src[i] === quote). Stops at the closing quote or end of line. */
function scanQuoted(src, i, quote) {
  const n = src.length;
  let j = i + 1, newlines = 0;
  while (j < n) {
    const d = src[j];
    if (d === '\\') {
      if (src[j + 1] === '\n') newlines++;
      j += 2; continue;
    }
    if (d === quote) { j++; break; }
    if (d === '\n') break; // unterminated literal: stop at end of line
    j++;
  }
  return { end: Math.min(j, n), newlines };
}

// ------------------------------------------------------------------ Python
const PY_STR_PREFIX = /^(r|u|f|b|br|rb|fr|rf)$/i;

function tokenizePython(src) {
  const sink = new Sink('python');
  const ops = OPS_SORTED.python;
  const n = src.length;
  let i = 0, line = 1;
  const indents = [0];
  let depth = 0;          // bracket depth: newlines inside brackets are ignored
  let atLineStart = true;
  let lineFirstTok = 0;   // sink index of the first token of the current logical line
  let lineHasTok = false, lineAllStr = true;

  const pushTok = (tok, s, e, l, kind) => {
    sink.push(tok, s, e, l, kind);
    lineHasTok = true;
    if (kind !== KIND.STR) lineAllStr = false;
  };
  const endLogicalLine = (pos) => {
    if (lineHasTok) {
      if (lineAllStr) sink.truncate(lineFirstTok); // docstring / bare string statement: drop it
      else sink.push('NEWLINE', pos, pos, line, KIND.STRUCT);
    }
    lineHasTok = false; lineAllStr = true; lineFirstTok = sink.length;
  };

  while (i < n) {
    if (atLineStart && depth === 0) {
      let col = 0, j = i;
      while (j < n && (src[j] === ' ' || src[j] === '\t' || src[j] === '\f')) {
        col = src[j] === '\t' ? (Math.floor(col / 8) + 1) * 8 : col + 1; j++;
      }
      if (j >= n) { i = j; break; }
      const c = src[j];
      if (c === '\n' || c === '\r' || c === '#') { // blank or comment-only line
        i = j;
        if (c === '#') { const s = i; while (i < n && src[i] !== '\n') i++; sink.comments.push({ start: s, end: i, line }); }
        if (src[i] === '\r') i++;
        if (src[i] === '\n') { i++; line++; }
        continue;
      }
      const top = indents[indents.length - 1];
      if (col > top) { indents.push(col); sink.push('INDENT', j, j, line, KIND.STRUCT); }
      else {
        while (col < indents[indents.length - 1]) { indents.pop(); sink.push('DEDENT', j, j, line, KIND.STRUCT); }
      }
      atLineStart = false; i = j;
      lineFirstTok = sink.length; lineHasTok = false; lineAllStr = true;
      continue;
    }

    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\f') { i++; continue; }
    if (c === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) {
      i += src[i + 1] === '\r' ? 3 : 2; line++; continue;
    }
    if (c === '\r' && src[i + 1] !== '\n') { i++; continue; }
    if (c === '\n' || c === '\r') {
      const s = i;
      if (c === '\r') i++;
      i++;
      if (depth > 0) { line++; continue; }
      endLogicalLine(s); line++; atLineStart = true; continue;
    }
    if (c === '#') { const s = i; while (i < n && src[i] !== '\n') i++; sink.comments.push({ start: s, end: i, line }); continue; }

    if (isIdStart(c)) {
      let j = i + 1;
      while (j < n && isIdPart(src[j])) j++;
      const word = src.slice(i, j);
      if ((src[j] === '"' || src[j] === "'") && PY_STR_PREFIX.test(word)) {
        const r = scanPyString(src, j);
        pushTok('STR', i, r.end, line, KIND.STR); line += r.newlines; i = r.end; continue;
      }
      if (KW_SET.python.has(word)) pushTok(word, i, j, line, KIND.FIXED);
      else {
        const before = sink.length;
        emitWord(sink, word, i, j, line, 'python', src);
        if (sink.length > before) { lineHasTok = true; lineAllStr = false; }
      }
      i = j; continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(src[i + 1]))) {
      let j = i + 1;
      while (j < n) {
        const d = src[j];
        if (isIdPart(d) || d === '.') { j++; continue; }
        if ((d === '+' || d === '-') && /[eE]/.test(src[j - 1]) && !/^0[xXbBoO]/.test(src.slice(i, j))) { j++; continue; }
        break;
      }
      pushTok('NUM', i, j, line, KIND.NUM); i = j; continue;
    }
    if (c === '"' || c === "'") {
      const r = scanPyString(src, i);
      pushTok('STR', i, r.end, line, KIND.STR); line += r.newlines; i = r.end; continue;
    }
    const op = matchOperator(src, i, ops);
    if (op) {
      if (op === '(' || op === '[' || op === '{') depth++;
      else if (op === ')' || op === ']' || op === '}') depth = Math.max(0, depth - 1);
      pushTok(op, i, i + op.length, line, KIND.FIXED);
      i += op.length; continue;
    }
    pushTok('<unk>', i, i + 1, line, KIND.UNK); i++;
  }
  endLogicalLine(n);
  while (indents.length > 1) { indents.pop(); sink.push('DEDENT', n, n, line, KIND.STRUCT); }
  return sink.finish(src);
}

/** Scans a Python string literal starting at its opening quote (handles triple quotes). */
function scanPyString(src, i) {
  const n = src.length;
  const q = src[i];
  let newlines = 0;
  if (src[i + 1] === q && src[i + 2] === q) {
    let j = i + 3;
    while (j < n) {
      if (src[j] === '\\') { if (src[j + 1] === '\n') newlines++; j += 2; continue; }
      if (src[j] === q && src[j + 1] === q && src[j + 2] === q) { j += 3; return { end: j, newlines }; }
      if (src[j] === '\n') newlines++;
      j++;
    }
    return { end: n, newlines };
  }
  const r = scanQuoted(src, i, q);
  return r;
}

// ------------------------------------------------------------------- public
/**
 * Tokenizes `text` written in `lang` ('python' | 'java' | 'c' | 'cpp').
 * Returns typed arrays: ids (vocab ids), starts/ends (char offsets), lines, kinds.
 */
export function tokenize(text, lang) {
  const src = String(text ?? '').replace(/^﻿/, '');
  if (lang === 'python') return tokenizePython(src);
  if (lang === 'java' || lang === 'c' || lang === 'cpp') return tokenizeCLike(src, lang);
  throw new Error(`Unsupported language: ${lang}`);
}

/** Human-readable token strings (for debugging and tests). */
export function tokenStrings(tok) {
  return Array.from(tok.ids, (id) => VOCAB[id]);
}
