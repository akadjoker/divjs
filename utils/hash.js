export function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

// The value of `TYPE name` and of Process.type. signal(), and anything
// else that takes "a process id OR a TYPE", tells the two apart by value,
// so the ranges must never meet. Process ids are positive and only grow
// (ProcessManager.nextId), and the plain hash is positive too: `TYPE a`
// was 97, and signal(TYPE a, s_kill) killed whatever process happened to
// have id 97. TYPE values are therefore strictly negative, in
// [-(2^31 - 1), -1], which keeps them 32-bit, non-zero (true in a
// condition, like DIV's) and disjoint from every id forever. Compiler and
// runtime must both go through this one function.
export function processTypeCode(name)
{
  return -(1 + (hashCode(String(name)) % 0x7FFFFFFE));
}
