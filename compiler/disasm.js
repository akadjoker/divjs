// Disassembler for the bytecode object Compiler.compile() actually
// returns: { constants, instructions, processTable, functionTable,
// globals, mainAddr }, where instructions is a flat array of plain
// { opcode, operands } objects.
//
// compiler/bytecode.js already has a disassemble() method — but it lives
// on the Bytecode/Instruction classes, which nothing in the real compile
// path ever instantiates (Compiler.emit()/addConstant() just push onto
// plain arrays on `this`). That disassemble() is unreachable dead code.
// This one works on the bytecode object you actually get back from
// `new Compiler().compile(ast)`.
//
// Output groups instructions under the PROCESS/FUNCTION/MAIN they belong
// to (derived from processTable/functionTable/mainAddr — the compiler
// itself doesn't record explicit end addresses, so this reconstructs
// them by sorting every entry point by address and taking each one's end
// as the next entry's start), and annotates operands that are otherwise
// just bare numbers: LOAD_CONST shows the actual constant value,
// LOAD_LOCAL/STORE_LOCAL resolves the slot to a variable name when the
// enclosing PROCESS's processTable.locals map has one (functionTable
// entries don't carry a locals map today, so slots inside a FUNCTION body
// print bare — see the note in buildAddressRanges), LOAD_GLOBAL/
// STORE_GLOBAL resolves against the bytecode's `globals` map, and jump
// opcodes are marked "-> target" instead of a bare address.

import { OpCodes, OpCodeNames } from './bytecode.js';

function invert(obj) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    out[value] = key;
  }
  return out;
}

function formatConstant(value) {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  return String(value);
}

function buildAddressRanges(bytecode) {
  const entries = [];

  for (const [name, info] of bytecode.functionTable) {
    // compileFunction() now publishes a .locals map for its own body,
    // same as processTable entries always have — resolves slot numbers
    // to variable names inside a FUNCTION instead of printing them bare.
    entries.push({ name, kind: 'FUNCTION', addr: info.addr, locals: info.locals || null });
  }
  for (const [name, info] of bytecode.processTable) {
    entries.push({ name, kind: 'PROCESS', addr: info.addr, locals: info.locals || null });
  }
  entries.push({ name: 'main', kind: 'MAIN', addr: bytecode.mainAddr, locals: bytecode.mainLocals || null });

  entries.sort((a, b) => a.addr - b.addr);
  for (let i = 0; i < entries.length; i++) {
    entries[i].end = i + 1 < entries.length ? entries[i + 1].addr : bytecode.instructions.length;
  }
  return entries;
}

function formatOperands(bytecode, instr, localsByIdx, globalsByIdx) {
  const ops = instr.operands || [];

  switch (instr.opcode) {
    case OpCodes.LOAD_CONST: {
      const idx = ops[0];
      const value = bytecode.constants[idx];
      return { text: String(idx), comment: formatConstant(value) };
    }

    case OpCodes.LOAD_LOCAL:
    case OpCodes.STORE_LOCAL: {
      const slot = ops[0];
      const varName = localsByIdx ? localsByIdx[slot] : undefined;
      return { text: String(slot), comment: varName };
    }

    case OpCodes.LOAD_GLOBAL:
    case OpCodes.STORE_GLOBAL: {
      const idx = ops[0];
      return { text: String(idx), comment: globalsByIdx[idx] };
    }

    case OpCodes.JUMP:
    case OpCodes.JUMP_IF_FALSE:
    case OpCodes.JUMP_IF_TRUE:
    case OpCodes.LOOP:
      return { text: `-> ${ops[0]}` };

    case OpCodes.CALL:
    case OpCodes.CALL_NATIVE:
    case OpCodes.SPAWN_PROCESS:
      // First operand is always the callee/process/native name (a
      // string); the rest, if any, are argument counts or similar.
      return { text: ops.map((o) => (typeof o === 'string' ? o : String(o))).join(', ') };

    case OpCodes.FRAME:
      return { text: ops[0] === 1 ? '(value from stack)' : '(default 100)' };

    default:
      return { text: ops.map((o) => (typeof o === 'string' ? JSON.stringify(o) : String(o))).join(', ') };
  }
}

// Returns the disassembly as a single string. `bytecode` is exactly what
// Compiler.compile() returns — no wrapping, no extra instantiation.
export function disassemble(bytecode) {
  const lines = [];
  const ranges = buildAddressRanges(bytecode);
  const globalsByIdx = invert(bytecode.globals);

  lines.push(`; ${bytecode.instructions.length} instructions, ${bytecode.constants.length} constants, ` +
    `${bytecode.processTable.size} processes, ${bytecode.functionTable.size} functions`);

  if (bytecode.constants.length > 0) {
    lines.push('');
    lines.push('; --- constant pool ---');
    bytecode.constants.forEach((value, idx) => {
      lines.push(`;   [${idx}] ${formatConstant(value)}`);
    });
  }

  for (const range of ranges) {
    const header = `== ${range.kind} ${range.name} `;
    lines.push('');
    lines.push(header + '='.repeat(Math.max(0, 60 - header.length)));

    const localsByIdx = range.locals ? invert(range.locals) : null;

    for (let addr = range.addr; addr < range.end; addr++) {
      const instr = bytecode.instructions[addr];
      const opName = OpCodeNames[instr.opcode] || `UNKNOWN(0x${instr.opcode.toString(16)})`;
      const { text, comment } = formatOperands(bytecode, instr, localsByIdx, globalsByIdx);

      let line = `${String(addr).padStart(5, ' ')}: ${opName.padEnd(14)} ${text}`;
      if (comment) {
        line += `  ; ${comment}`;
      }
      lines.push(line);
    }
  }

  return lines.join('\n');
}
