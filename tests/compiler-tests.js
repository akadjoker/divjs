// Compiler regression tests. They only need the lexer,
// parser, compiler and the bare VM - no canvas - so they also run under
// Node.
import { Lexer } from '../compiler/tokenizer.js';
import { Parser } from '../parser/parser.js';
import { Compiler } from '../compiler/compiler.js';
import { VM } from '../vm/vm.js';
import { disassemble } from '../compiler/disasm.js';
import { DivError } from '../compiler/errors.js';

function compileSource(source)
{
  const tokens = new Lexer(source).tokenize();
  const ast = new Parser(tokens).parse();
  return new Compiler().compile(ast);
}

function assert(condition, message)
{
  if (!condition)
  {
    throw new Error(message);
  }
}

// Compiles and runs `source` for a few ticks with a `say` native that
// records its arguments. Returns what was said and every scalar global
// by name (as a host reads them, through bytecode.globals).
function runSource(source, ticks = 3)
{
  const bytecode = compileSource(source);
  const vm = new VM();
  const said = [];
  vm.registerNative('say', (...args) =>
  {
    said.push(args.join(','));
    return 0;
  });
  vm.load(bytecode);
  for (let i = 0; i < ticks; i++)
  {
    vm.tick();
  }
  const globals = {};
  for (const [name, slot] of Object.entries(bytecode.globals))
  {
    globals[name] = vm.globals.get(slot) ?? 0;
  }
  return { said, globals, bytecode };
}

// Asserts that compiling `source` throws a DivError from `stage` at
// line:col whose reason contains `fragment`.
function expectDivError(label, source, stage, line, col, fragment)
{
  let error = null;
  try
  {
    compileSource(source);
  }
  catch (e)
  {
    error = e;
  }
  assert(error !== null, `${label}: devia dar erro de compilacao`);
  assert(error instanceof DivError, `${label}: devia ser DivError, obtido ${error.name}: ${error.message}`);
  assert(error.stage === stage, `${label}: stage esperado ${stage}, obtido ${error.stage} (${error.message})`);
  assert(error.line === line && error.col === col,
    `${label}: posicao esperada ${line}:${col}, obtido ${error.line}:${error.col} (${error.message})`);
  assert(error.reason.includes(fragment),
    `${label}: a mensagem devia conter ${JSON.stringify(fragment)}, obtido ${JSON.stringify(error.message)}`);
}

async function testForLoopUsesGlobalCounter()
{
  // FOR with a GLOBAL counter created a local of the same name.
  const { said, globals } = runSource(`PROGRAM t;
GLOBAL i; after;
BEGIN
  FOR i = 0 TO 4
  END
  after = i;
  say(i);
END`);
  assert(globals.i === 5, `global i devia terminar em 5, obtido ${globals.i}`);
  assert(globals.after === 5 && said[0] === '5', `depois do FOR, i devia ler a global (5), obtido ${globals.after} / ${said[0]}`);
}

async function testCompoundAssignEvaluatesIndexOnce()
{
  // "a[k()] += 1" and "a[k()]++" called k() twice (read a[1], wrote a[2]).
  const source = (statement) => `PROGRAM t;
GLOBAL a[3]; calls;
FUNCTION k() BEGIN calls = calls + 1; RETURN calls; END
BEGIN a[1] = 5; a[2] = 100; ${statement} say(a[1], a[2], calls); END`;
  for (const statement of ['a[k()] += 1;', 'a[k()]++;'])
  {
    const { said } = runSource(source(statement));
    assert(said[0] === '6,100,1', `${statement} devia dar a[1]=6, a[2]=100, k() 1 vez; obtido ${said[0]}`);
  }
  const { said } = runSource(`PROGRAM t;
GLOBAL a[3]; calls;
FUNCTION k() BEGIN calls = calls + 1; RETURN calls; END
BEGIN a[1] = 5; a[2] = 100; a[k()] -= 2; a[1] *= 3; a[k()]--; say(a[1], a[2], calls); END`);
  assert(said[0] === '9,99,2', `-=, *= e -- deviam dar 9,99,2; obtido ${said[0]}`);
}

async function testAssignmentExpressionEvaluatesIndexOnce()
{
  // An assignment used as a value re-read its target, evaluating
  // the index again (and reading a different cell).
  const { said } = runSource(`PROGRAM t;
GLOBAL a[3]; calls; r; q;
FUNCTION k() BEGIN calls = calls + 1; RETURN calls; END
BEGIN
  a[2] = 0;
  r = (a[k()] = 9);
  q = (a[k()] += 4);
  say(r, q, a[1], a[2], calls);
END`);
  assert(said[0] === '9,4,9,4,2', `esperado r=9, q=4, a[1]=9, a[2]=4, k() 2 vezes; obtido ${said[0]}`);
}

async function testLocalSectionInitializers()
{
  // "LOCAL hp = 10;" started every process (and MAIN) at 0.
  const { globals } = runSource(`PROGRAM t;
GLOBAL got; main_hp; given;
LOCAL hp = 10; mp = 3; t[2];
PROCESS p(mp)
BEGIN
  t[2] = hp + 1;
  got = hp * 100 + t[2];
  given = mp;
END
BEGIN main_hp = hp; p(7); END`);
  assert(globals.main_hp === 10, `MAIN devia comecar com hp=10, obtido ${globals.main_hp}`);
  assert(globals.got === 1011, `o processo devia comecar com hp=10 (e ter a tabela LOCAL t), obtido ${globals.got}`);
  assert(globals.given === 7, `o parametro mp devia prevalecer sobre o valor inicial do LOCAL, obtido ${globals.given}`);
}

async function testDashDashCommentAfterValue()
{
  // "--" after ")", a number or a name was read as a decrement.
  const { globals } = runSource(`PROGRAM t;
GLOBAL r; step = 3;
BEGIN
  IF (r == 0) -- zero case
    r = 1;
  END
  r = r + 5 -- trailing comment
  ;
  FOR i = 0 TO 3 -- four times
    r = r + 1;
  END
  step--;
  step --;
END`);
  assert(globals.r === 10, `-- devia ser comentario depois de ), numero e nome; r esperado 10, obtido ${globals.r}`);
  assert(globals.step === 1, `step-- devia decrementar a variavel step, obtido ${globals.step}`);
}

async function testNamesAreCaseInsensitive()
{
  // Keywords were case-insensitive but names were not ("X = 50"
  // created a new local; x stayed 0).
  const { said, globals, bytecode } = runSource(`PROGRAM t;
GLOBAL gx; Score; Hits;
STRUCT Pos a; B; END
PROCESS Mover()
BEGIN
  X = 50;
  gx = x;
  SCORE = 4;
  pos.A = 7;
  POS.b = 8;
  IF (Type Mover == TYPE mover) HITS = 1; END
  LOOP FRAME; END
END
BEGIN mover(); SAY(score, Pos.a, pos.B); END`);
  assert(globals.gx === 50, `X e x deviam ser a mesma variavel, obtido gx=${globals.gx}`);
  assert(globals.score === 4, `Score/SCORE/score deviam ser a mesma global, obtido ${globals.score}`);
  assert(globals.hits === 1, `TYPE Mover e TYPE mover deviam ser iguais, obtido ${globals.hits}`);
  assert(said[0] === '4,7,8', `SAY devia chamar o nativo say e ler os campos da STRUCT, obtido ${said[0]}`);
  assert(bytecode.processTable.has('mover'), 'o processo devia ser publicado como "mover" em processTable');
}

async function testStructInitializerCompilesExpressions()
{
  // Only bare numeric literals were kept; "1+1" or "-v" became 0.
  const { said } = runSource(`PROGRAM t;
GLOBAL v = 4;
STRUCT s[1] a; b; END = 1+1, -v, 7;
BEGIN say(s[0].a, s[0].b, s[1].a, s[1].b); END`);
  assert(said[0] === '2,-4,7,0', `inicializador da STRUCT esperado 2,-4,7,0; obtido ${said[0]}`);
  expectDivError('STRUCT com valores a mais', `PROGRAM t;
STRUCT s[1] a; END = 1, 2, 3;
BEGIN END`, 'compiler', 2, 1, 'initial values');
}

async function testPrivateNamedLikeParameterIsError()
{
  // The PRIVATE shared the parameter's slot and zeroed the argument.
  expectDivError('PRIVATE com nome de parametro', `PROGRAM t;
PROCESS p(speed)
PRIVATE
  speed;
BEGIN END
BEGIN p(7); END`, 'compiler', 4, 3, 'same name as a parameter');
}

async function testGlobalNamedLikeProcessFieldIsError()
{
  // Inside every process the predefined local of the same name won.
  expectDivError('GLOBAL size', `PROGRAM t;
GLOBAL score; size = 5;
BEGIN END`, 'compiler', 2, 15, 'predefined process variable');
  expectDivError('GLOBAL igual a um LOCAL', `PROGRAM t;
LOCAL energy;
GLOBAL energy;
BEGIN END`, 'compiler', 3, 8, 'LOCAL section');
}

async function testIndexingScalarStructFieldIsError()
{
  // "s[0].a[1]" on a scalar field silently read s[1].a.
  expectDivError('campo escalar indexado', `PROGRAM t;
STRUCT s[1] a; b; END
BEGIN
  say(s[0].a[1]);
END`, 'compiler', 4, 7, 'not an array or a STRUCT');
}

async function testUndeclaredPathRootIsError()
{
  // "foo[3] = 5" compiled to __set_path and read back 0 at runtime.
  expectDivError('raiz nao declarada', `PROGRAM t;
BEGIN
  foo[3] = 5;
END`, 'compiler', 3, 3, 'Unknown variable: foo');
  expectDivError('dois indices numa tabela', `PROGRAM t;
GLOBAL a[3];
BEGIN
  a[1][0] = 5;
END`, 'compiler', 4, 3, '"a" is not declared with this shape');
  // The runtime's own roots still compile.
  compileSource(`PROGRAM t;
GLOBAL r;
BEGIN
  scroll.x0 = 1; scroll[0].y0 = 2; region.x = 3;
  r = father.x + son.graph + mouse.x;
END`);
}

async function testExtraArrayInitializersIsError()
{
  // Values past the last cell were dropped without a word.
  expectDivError('valores a mais', `PROGRAM t;
GLOBAL a[1] = 1, 2, 3;
BEGIN END`, 'compiler', 2, 8, '2 cells but 3 initial values');
  const { globals } = runSource(`PROGRAM t; GLOBAL a[2] = 1, 2, 3; r; BEGIN r = a[0] + a[1] + a[2]; END`);
  assert(globals.r === 6, `inicializador completo devia continuar a funcionar, obtido ${globals.r}`);
}

async function testMalformedNumberIsLexerError()
{
  // "1.2.3" was read as 1.2.
  expectDivError('1.2.3', `PROGRAM t;
GLOBAL r = 1.2.3;
BEGIN END`, 'lexer', 2, 12, 'Malformed number');
}

async function testUnterminatedBlockCommentIsLexerError()
{
  // An unclosed /* swallowed the rest of the file.
  expectDivError('/* sem fim', `PROGRAM t;
GLOBAL r = 1;
BEGIN
  r = 2; /* never closed
  r = 3;
END`, 'lexer', 4, 10, 'Unterminated /* comment');
}

async function testLocalSectionsParse()
{
  // A second LOCAL section was a syntax error; a STRUCT inside LOCAL
  // failed with "Expected private name".
  const { globals } = runSource(`PROGRAM t;
GLOBAL r;
LOCAL a = 1;
LOCAL b = 2;
PROCESS p() BEGIN r = a + b; END
BEGIN p(); END`);
  assert(globals.r === 3, `duas seccoes LOCAL deviam ser aceites, obtido r=${globals.r}`);
  expectDivError('STRUCT em LOCAL', `PROGRAM t;
LOCAL a;
STRUCT s b; END
BEGIN END`, 'parser', 3, 1, 'STRUCT inside a LOCAL section');
}

async function testFunctionPrivateSection()
{
  // Decision: a FUNCTION takes a PRIVATE section like a PROCESS. Its
  // variables start from their initial value on every call - recursion
  // included - and may not reuse a parameter's name.
  const { globals } = runSource(`PROGRAM t;
GLOBAL r; s;
FUNCTION count_down(n)
PRIVATE acc = 100; tmp;
BEGIN
  tmp = n;
  IF (n > 0) acc = acc + count_down(n - 1); END
  RETURN acc + tmp;
END
FUNCTION first(a)
PRIVATE b = 5;
BEGIN
  b = b + a;
  RETURN b;
END
BEGIN
  r = count_down(2);
  s = first(1) + first(1);
END`);
  // count_down(0) = 100; (1) = 100 + 100 + 1 = 201; (2) = 100 + 201 + 2 = 303
  assert(globals.r === 303, `PRIVATE de FUNCTION devia ser proprio de cada chamada, r=${globals.r}`);
  assert(globals.s === 12, `PRIVATE de FUNCTION devia recomecar no valor inicial, s=${globals.s}`);
  expectDivError('PRIVATE com nome de parametro em FUNCTION', `PROGRAM t;
FUNCTION f(a)
PRIVATE a;
BEGIN RETURN a; END
BEGIN END`, 'compiler', 3, 9, 'same name as a parameter of this FUNCTION');
}

async function testDisasmShowsGlobalInitialisation()
{
  // The code before the first body (global initialisers and the
  // jump to MAIN) was never printed.
  const text = disassemble(compileSource(`PROGRAM t;
GLOBAL score = 77;
BEGIN score = 1; END`));
  const lines = text.split('\n');
  const initHeader = lines.findIndex((line) => line.startsWith('== INIT'));
  const mainHeader = lines.findIndex((line) => line.startsWith('== MAIN'));
  assert(initHeader >= 0 && initHeader < mainHeader, `o disasm devia ter uma seccao INIT antes do MAIN:\n${text}`);
  const initBody = lines.slice(initHeader + 1, mainHeader).join('\n');
  assert(/^\s+0: LOAD_CONST/m.test(initBody) && initBody.includes('; 77') && initBody.includes('STORE_GLOBAL'),
    `a seccao INIT devia mostrar a inicializacao de score = 77:\n${text}`);
}

async function testFromWithoutStepCountsTowardsFinal()
{
  // DIV 2 manual 7.6.8: FROM without STEP adds 1 when the initial value
  // is less than the final one and subtracts 1 otherwise, so
  // "FROM x=9 TO 0;" runs 10 times. It used to run 0 times.
  const { globals } = runSource(`PROGRAM t;
GLOBAL n; sum; hi = 3; lo = 1; down; up; lastdown; empty; stepped;
BEGIN
  FROM x = 9 TO 0; n = n + 1; sum = sum + x; END
  FROM i = hi TO lo; down = down * 10 + i; END
  lastdown = i;
  FROM i = lo TO hi; up = up * 10 + i; END
  FOR j = 0 TO lo - 2
    empty = empty + 1;
  END
  FROM k = 0 TO 6 STEP 3; stepped = stepped + 1; END
END`);
  assert(globals.n === 10 && globals.sum === 45, `FROM x=9 TO 0 devia correr 10 vezes (soma 45), obtido n=${globals.n} soma=${globals.sum}`);
  assert(globals.down === 321 && globals.lastdown === 0, `FROM com limites variaveis devia descer 3,2,1; obtido ${globals.down} (i final ${globals.lastdown})`);
  assert(globals.up === 123, `FROM com limites variaveis devia subir 1,2,3; obtido ${globals.up}`);
  assert(globals.empty === 0, `FOR ... TO sem STEP deve continuar a nao correr com intervalo vazio, obtido ${globals.empty}`);
  assert(globals.stepped === 3, `FROM com STEP explicito nao devia mudar, obtido ${globals.stepped}`);
}

async function testForLimitIsEvaluatedOnce()
{
  // Decision: the TO limit of FOR/FROM is evaluated once, when the loop
  // starts (like STEP). It used to be re-evaluated on every pass, so a
  // function call in it ran each time and a limit moved by the body kept
  // the loop going.
  const { globals } = runSource(`PROGRAM t;
GLOBAL calls; n1; n; n2; d;
FUNCTION lim()
BEGIN
  calls = calls + 1;
  RETURN 4;
END
BEGIN
  FOR i = 0 TO lim()
    n1 = n1 + 1;
  END
  n = 2;
  FOR j = 0 TO n
    n = n + 1;
    n2 = n2 + 1;
  END
  d = 3;
  FROM k = d TO 0;
    d = d + 1;
  END
END`);
  assert(globals.calls === 1, `lim() devia ser chamada 1 vez, foi chamada ${globals.calls}`);
  assert(globals.n1 === 5, `FOR 0 TO lim() devia dar 5 voltas, deu ${globals.n1}`);
  assert(globals.n2 === 3, `FOR 0 TO n com n alterado no corpo devia dar 3 voltas, deu ${globals.n2}`);
  assert(globals.d === 7, `FROM d TO 0 devia dar 4 voltas (d 3 -> 7), d=${globals.d}`);
}

async function testStructDefaultsFillWhatTheListLeaves()
{
  // Decision: with both field defaults and an initializer list, the list
  // wins where it reaches and the defaults fill the remaining fields.
  // The defaults used to be dropped as soon as a list was present.
  const { said } = runSource(`PROGRAM t;
STRUCT s[1] a = 5; b = 6; END = 1;
STRUCT u[1] p = 8; q; END
BEGIN say(s[0].a, s[0].b, s[1].a, s[1].b, u[1].p, u[1].q); END`);
  assert(said[0] === '1,6,5,6,8,0', `lista + defaults esperado 1,6,5,6,8,0; obtido ${said[0]}`);
}

export const compilerTests = [
  ['compiler: STRUCT defaults fill what the initializer list leaves (decision)', testStructDefaultsFillWhatTheListLeaves],
  ['compiler: FOR/FROM evaluate the TO limit once (decision)', testForLimitIsEvaluatedOnce],
  ['compiler: FOR with a GLOBAL counter uses the global', testForLoopUsesGlobalCounter],
  ['compiler: compound assignment evaluates the index once', testCompoundAssignEvaluatesIndexOnce],
  ['compiler: assignment used as a value evaluates the index once', testAssignmentExpressionEvaluatesIndexOnce],
  ['compiler: LOCAL section initializers', testLocalSectionInitializers],
  ['lexer: -- comment after ), a number or a name', testDashDashCommentAfterValue],
  ['compiler: names are case-insensitive', testNamesAreCaseInsensitive],
  ['compiler: STRUCT initializer compiles expressions', testStructInitializerCompilesExpressions],
  ['compiler: PRIVATE named like a parameter is an error', testPrivateNamedLikeParameterIsError],
  ['compiler: GLOBAL named like a process field is an error', testGlobalNamedLikeProcessFieldIsError],
  ['compiler: indexing a scalar STRUCT field is an error', testIndexingScalarStructFieldIsError],
  ['compiler: undeclared dotted/indexed root is an error', testUndeclaredPathRootIsError],
  ['compiler: extra GLOBAL array initial values is an error', testExtraArrayInitializersIsError],
  ['lexer: 1.2.3 is an error', testMalformedNumberIsLexerError],
  ['lexer: unterminated /* is an error', testUnterminatedBlockCommentIsLexerError],
  ['parser: several LOCAL sections', testLocalSectionsParse],
  ['compiler: a FUNCTION takes a PRIVATE section (decision)', testFunctionPrivateSection],
  ['disasm: shows the global initialisation code', testDisasmShowsGlobalInitialisation],
  ['compiler: FROM without STEP counts towards the final value', testFromWithoutStepCountsTowardsFinal]
];
