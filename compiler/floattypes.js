// Float typing for "/" (see Compiler.compile).
//
// DIV's "/" is an integer division; DivJS also has fractional numbers,
// and a JS number can't tell 5.0 from 5, so the VM's DIV only truncates
// when both values are whole. That made "1.0 / 2" 0. This pass decides,
// for every "/" of the program, whether a side of it is float-typed; the
// compiler then emits FDIV (always a real division) for it.
//
// What is a float:
// - a literal written with a decimal point ("1.0", "0.5"), a call to one
//   of FLOAT_NATIVES (get_delta, sin...) and arithmetic (+ - * / %) with a
//   float operand. Comparisons, logic and other calls give no float.
// - a variable of a PROCESS, FUNCTION or MAIN (parameter, PRIVATE or a
//   name first assigned in the body), at a given point of its body: it is
//   a float after being given a float, and stops being one when given
//   anything else. Where paths join (after IF, SWITCH, around loops) it is
//   a float only if it is one on every path.
// - anything else that holds a value - a GLOBAL, an element of an array,
//   a STRUCT field, a LOCAL, a parameter on entry, a FUNCTION's result -
//   when it is given a float somewhere and everything it is ever given is
//   a float or a whole literal (a reset such as "speed = 0;").
// The predefined process fields (x, y, angle...) are never float-typed.
//
// The compiler's first pass resolves the names; `info` carries what it
// recorded:
//   keys:  WeakMap node -> key (variables, elements, fields, VAR and FOR
//          statements, assignment targets), see Compiler.targetKey.
//   calls: WeakMap call node -> { kind: 'PROCESS' | 'FUNCTION' | 'NATIVE', name, params }
// Keys: G:<global>, G:<array>[], S:<struct>.<field>, L:<LOCAL>, R:<function>,
// <PROCESS|FUNCTION|MAIN>:<routine>:<name> (and ...[] for arrays).

function isFlowKey(key)
{
  return typeof key === 'string' && !key.endsWith('[]') &&
    (key.startsWith('PROCESS:') || key.startsWith('FUNCTION:') || key.startsWith('MAIN:'));
}

function isWholeLiteral(expr)
{
  if (!expr)
  {
    return false;
  }
  if (expr.type === 'number')
  {
    return expr.isFloat !== true;
  }
  return expr.type === 'unary' && expr.operator === '-' && isWholeLiteral(expr.operand);
}

// Floats on every path: a key is a float after a join only if it is one
// in every state joined.
function meet(states)
{
  const live = states.filter(Boolean);
  if (live.length === 0)
  {
    return null;
  }
  const out = new Map();
  for (const [key, value] of live[0])
  {
    if (value && live.every((s) => s.get(key) === true))
    {
      out.set(key, true);
    }
  }
  return out;
}

function sameState(a, b)
{
  if (a === null || b === null)
  {
    return a === b;
  }
  if (a.size !== b.size)
  {
    return false;
  }
  for (const [key, value] of a)
  {
    if (b.get(key) !== value)
    {
      return false;
    }
  }
  return true;
}

class Walker
{
  constructor(info, floatNatives, typed)
  {
    this.keys = info.keys;
    this.calls = info.calls;
    this.floatNatives = floatNatives;
    // typed: the non-flow keys taken as floats in this run (a Set, or
    // null for "all of them").
    this.typed = typed;
    // Last value seen for each "/" (and "/=" statement), and for each
    // place a non-flow key is given a value.
    this.decisions = new Map();
    this.records = new Map();
    this.state = new Map();
    this.loops = [];
    this.routine = null;
  }

  isTyped(key)
  {
    return this.typed === null ? true : this.typed.has(key);
  }

  readKey(key)
  {
    if (!key)
    {
      return false;
    }
    if (isFlowKey(key))
    {
      return this.state !== null && this.state.get(key) === true;
    }
    return this.isTyped(key);
  }

  // `node` gives `key` the value `valueExpr`, which is a float or not.
  give(node, key, isFloat, valueExpr)
  {
    if (!key)
    {
      return;
    }
    if (isFlowKey(key))
    {
      if (this.state !== null)
      {
        this.state.set(key, isFloat);
      }
      return;
    }
    this.records.set(node, { key, isFloat, neutral: !isFloat && isWholeLiteral(valueExpr) });
  }

  // Walks the index expressions of an access path (they can hold
  // divisions and calls of their own).
  walkPath(expr)
  {
    let node = expr;
    while (node.type === 'member_access' || node.type === 'index_access')
    {
      if (node.type === 'index_access')
      {
        this.expr(node.index);
      }
      node = node.object;
    }
  }

  // Evaluates an expression for its effects (assignments, calls, nested
  // divisions) and returns whether it is a float.
  expr(expr)
  {
    if (!expr)
    {
      return false;
    }
    switch (expr.type)
    {
      case 'number':
        return expr.isFloat === true;
      case 'identifier':
        return this.readKey(this.keys.get(expr));
      case 'member_access':
      case 'index_access':
        this.walkPath(expr);
        return this.readKey(this.keys.get(expr));
      case 'unary':
      {
        const operand = this.expr(expr.operand);
        return expr.operator === '-' && operand;
      }
      case 'binary':
      {
        if (expr.operator === '&&' || expr.operator === '||')
        {
          this.expr(expr.left);
          const afterLeft = this.state && new Map(this.state);
          this.expr(expr.right);
          this.state = meet([afterLeft, this.state]);
          return false;
        }
        const left = this.expr(expr.left);
        const right = this.expr(expr.right);
        if (expr.operator === '/')
        {
          this.decisions.set(expr, left || right);
        }
        return ['+', '-', '*', '/', '%'].includes(expr.operator) && (left || right);
      }
      case 'assign':
        return this.assign(expr);
      case 'call':
        return this.call(expr);
      default:
        return false;
    }
  }

  assign(node)
  {
    const target = node.target;
    if (target.type === 'member_access' || target.type === 'index_access')
    {
      this.walkPath(target);
    }
    const key = this.keys.get(target);
    let isFloat;
    if (node.operator)
    {
      const current = this.readKey(key);
      const value = this.expr(node.value);
      if (node.operator === '/')
      {
        this.decisions.set(node, current || value);
      }
      isFloat = current || value;
      this.give(node, key, isFloat, null);
    }
    else
    {
      isFloat = this.expr(node.value);
      this.give(node, key, isFloat, node.value);
    }
    return isFloat;
  }

  call(node)
  {
    const info = this.calls.get(node);
    const floats = node.args.map((arg) => this.expr(arg));
    if (!info)
    {
      return false;
    }
    if (info.kind === 'NATIVE')
    {
      return this.floatNatives.has(info.name);
    }
    info.params.forEach((param, i) =>
    {
      const key = info.paramKeys[i];
      if (key)
      {
        this.records.set(node.args[i], { key, isFloat: floats[i], neutral: !floats[i] && isWholeLiteral(node.args[i]) });
      }
    });
    return info.kind === 'FUNCTION' && this.isTyped(`R:${info.name}`);
  }

  block(block)
  {
    for (const stmt of (block && block.statements) || [])
    {
      this.stmt(stmt);
    }
  }

  // Runs `body` (a function walking one pass of the loop) until the state
  // at the top of the loop stops changing; continue states feed the top,
  // break states the exit.
  loop(pass)
  {
    const entry = this.state;
    let head = entry;
    let exit = null;
    for (let i = 0; i < 64; i++)
    {
      const ctx = { breaks: [], continues: [] };
      this.loops.push(ctx);
      this.state = head && new Map(head);
      const leftAt = pass();
      this.loops.pop();
      const end = this.state;
      const next = meet([entry, end, ...ctx.continues]);
      exit = meet([leftAt === undefined ? head : leftAt, end, ...ctx.breaks]);
      if (sameState(next, head))
      {
        break;
      }
      head = next;
    }
    this.state = exit;
  }

  stmt(stmt)
  {
    switch (stmt.type)
    {
      case 'expression':
        this.expr(stmt.expression);
        break;
      case 'var':
        this.give(stmt, this.keys.get(stmt), this.expr(stmt.value), stmt.value);
        break;
      case 'frame':
        this.expr(stmt.value);
        break;
      case 'return':
        if (stmt.value)
        {
          const isFloat = this.expr(stmt.value);
          if (this.routine.kind === 'FUNCTION')
          {
            this.records.set(stmt, { key: `R:${this.routine.name}`, isFloat, neutral: !isFloat && isWholeLiteral(stmt.value) });
          }
        }
        this.state = null;
        break;
      case 'break':
        if (this.loops.length > 0)
        {
          this.loops[this.loops.length - 1].breaks.push(this.state);
        }
        this.state = null;
        break;
      case 'continue':
        if (this.loops.length > 0)
        {
          this.loops[this.loops.length - 1].continues.push(this.state);
        }
        this.state = null;
        break;
      case 'if':
      {
        this.expr(stmt.condition);
        const before = this.state;
        this.state = before && new Map(before);
        this.block(stmt.thenBranch);
        const afterThen = this.state;
        this.state = before && new Map(before);
        if (stmt.elseBranch)
        {
          this.block(stmt.elseBranch);
        }
        this.state = meet([afterThen, this.state]);
        break;
      }
      case 'switch':
      {
        this.expr(stmt.subject);
        const before = this.state;
        const ends = [];
        for (const c of stmt.cases)
        {
          this.state = before && new Map(before);
          for (const value of c.values)
          {
            this.expr(value.type === 'range' ? value.from : value);
            if (value.type === 'range')
            {
              this.expr(value.to);
            }
          }
          this.block(c.body);
          ends.push(this.state);
        }
        this.state = before && new Map(before);
        if (stmt.defaultBody)
        {
          this.block(stmt.defaultBody);
        }
        ends.push(this.state);
        this.state = meet(ends);
        break;
      }
      case 'while':
        this.loop(() =>
        {
          this.expr(stmt.condition);
          const leftAt = this.state && new Map(this.state);
          this.block(stmt.body);
          return leftAt;
        });
        break;
      case 'loop':
        this.loop(() =>
        {
          this.block(stmt.body);
          return null;
        });
        break;
      case 'repeat':
        this.loop(() =>
        {
          this.block(stmt.body);
          this.expr(stmt.condition);
          return undefined;
        });
        break;
      case 'cfor':
        this.expr(stmt.init);
        this.loop(() =>
        {
          this.expr(stmt.condition);
          const leftAt = this.state && new Map(this.state);
          this.block(stmt.body);
          this.expr(stmt.step);
          return leftAt;
        });
        break;
      case 'for':
      {
        const key = this.keys.get(stmt);
        this.give(stmt, key, this.expr(stmt.start), stmt.start);
        this.expr(stmt.end);
        const stepFloat = this.expr(stmt.step);
        this.loop(() =>
        {
          const leftAt = this.state && new Map(this.state);
          this.block(stmt.body);
          if (key && isFlowKey(key) && this.state !== null)
          {
            this.state.set(key, this.readKey(key) || stepFloat);
          }
          return leftAt;
        });
        if (key && !isFlowKey(key) && stmt.step)
        {
          this.records.set(stmt.step, { key, isFloat: stepFloat, neutral: !stepFloat && isWholeLiteral(stmt.step) });
        }
        break;
      }
      default:
        break;
    }
  }

  // One body: its parameters start as their entry typing, PRIVATEs as
  // their initial value.
  routineBody(routine)
  {
    this.routine = routine;
    this.state = new Map();
    this.loops = [];
    for (const key of routine.paramKeys)
    {
      if (key && isFlowKey(key) && this.isTyped(key))
      {
        this.state.set(key, true);
      }
    }
    for (const { node, key, value } of routine.inits)
    {
      this.give(node, key, value ? this.expr(value) : false, value);
    }
    this.block(routine.body);
  }

  run(program)
  {
    this.routine = { kind: 'MAIN', name: '' };
    this.state = null;
    for (const { node, key, value } of program.declarations)
    {
      this.give(node, key, this.expr(value), value);
    }
    for (const routine of program.routines)
    {
      this.routineBody(routine);
    }
  }
}

// Returns a Map from each "/" binary node (and "/=" assignment node) of
// the program to true when it must be a float division.
export function analyzeFloatDivisions(program, info, floatNatives)
{
  const run = (typed) =>
  {
    const walker = new Walker(info, floatNatives, typed);
    walker.run(program);
    const byKey = new Map();
    for (const record of walker.records.values())
    {
      if (!byKey.has(record.key))
      {
        byKey.set(record.key, []);
      }
      byKey.get(record.key).push(record);
    }
    return { walker, byKey };
  };

  // The largest set of keys that are given nothing but floats and whole
  // literals (taking the set itself as floats)...
  let typed = null;
  for (let i = 0; i < 64; i++)
  {
    const { byKey } = run(typed);
    const next = new Set([...byKey.keys()].filter((key) =>
      byKey.get(key).every((r) => r.isFloat || r.neutral) && (typed === null || typed.has(key))));
    if (typed !== null && next.size === typed.size)
    {
      break;
    }
    typed = next;
  }
  // ...and, within it, the keys a float actually reaches.
  const candidates = typed;
  let reached = new Set();
  let last = run(reached);
  for (let i = 0; i < 64; i++)
  {
    const next = new Set([...candidates].filter((key) =>
      reached.has(key) || (last.byKey.get(key) || []).some((r) => r.isFloat)));
    if (next.size === reached.size)
    {
      break;
    }
    reached = next;
    last = run(reached);
  }
  return last.walker.decisions;
}
