// String functions. DivJS strings are values ("s = a + b" joins them,
// "s = 'text'" copies), so the functions that change a string in DIV 2
// (upper, lower, strdel...) return the new string instead: s = upper(s).
// Positions count from 0; a number passed as a string is used as its
// text ("12" for 12).

function text(value)
{
  return value === undefined || value === null ? '' : String(value);
}

function whole(value, fallback = 0)
{
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

export const STRING_NATIVES = {
  // DIV 2 names.
  strlen: (s) => text(s).length,
  strcmp: (a, b) =>
  {
    const x = text(a);
    const y = text(b);
    return x < y ? -1 : (x > y ? 1 : 0);
  },
  strstr: (s, part) => text(s).indexOf(text(part)),
  strchr: (s, chars) =>
  {
    const str = text(s);
    const set = text(chars);
    for (let i = 0; i < str.length; i++)
    {
      if (set.includes(str[i]))
      {
        return i;
      }
    }
    return -1;
  },
  upper: (s) => text(s).toUpperCase(),
  lower: (s) => text(s).toLowerCase(),
  strdel: (s, fromStart, fromEnd) =>
  {
    const str = text(s);
    const start = Math.max(0, whole(fromStart));
    const end = Math.max(0, whole(fromEnd));
    return start + end >= str.length ? '' : str.slice(start, str.length - end);
  },
  itoa: (n) => String(whole(n)),
  char: (s) =>
  {
    const str = text(s);
    return str.length > 0 ? str.charCodeAt(0) : 0;
  },
  // DivJS additions.
  substr: (s, start, count) =>
  {
    const str = text(s);
    let from = whole(start);
    if (from < 0)
    {
      from = Math.max(0, str.length + from);
    }
    const n = count === undefined ? str.length : Math.max(0, whole(count));
    return str.substr(from, n);
  },
  asc: (s, index) =>
  {
    const str = text(s);
    const i = whole(index);
    return i >= 0 && i < str.length ? str.charCodeAt(i) : 0;
  },
  chr: (code) => String.fromCharCode(Math.max(0, whole(code)) & 0xffff)
};

export function registerStringNatives(vm)
{
  for (const [name, fn] of Object.entries(STRING_NATIVES))
  {
    vm.registerNative(name, fn);
  }
}
