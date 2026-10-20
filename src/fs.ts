import { posix } from "node:path";

export type TemplateFS =
  | Record<string, string>
  | { readFile(name: string): string; glob(pattern: string): string[] };

const badPattern = (): never => {
  throw Error("syntax error in pattern");
};
const compare = (a: string, b: string) =>
  Buffer.compare(Buffer.from(a), Buffer.from(b));
const hasMeta = (pattern: string) => /[*?[\\]/.test(pattern);
type Token = "*" | { accepts(c: string): boolean };

// Compile Go path.Match syntax. The dynamic-programming matcher avoids the
// exponential backtracking of a regular expression with many wildcard groups.
export function compileMatch(pattern: string) {
  const chars = Array.from(pattern);
  const tokens: Token[] = [];
  let i = 0;
  const classChar = (): number => {
    let c = chars[i++];
    if (c === undefined || c === "-" || c === "]") return badPattern();
    if (c === "\\") c = chars[i++] ?? badPattern();
    if (i === chars.length) return badPattern();
    return c.codePointAt(0)!;
  };
  while (i < chars.length) {
    let c = chars[i++];
    if (c === "*") {
      if (tokens.at(-1) !== "*") tokens.push("*");
    } else if (c === "?") tokens.push({ accepts: (c) => c !== "/" });
    else if (c === "[") {
      const negated = chars[i] === "^";
      if (negated) i++;
      const ranges: [number, number][] = [];
      do {
        const lo = classChar();
        let hi = lo;
        if (chars[i] === "-") {
          i++;
          hi = classChar();
        }
        ranges.push([lo, hi]);
      } while (chars[i] !== "]");
      i++;
      tokens.push({
        accepts(c) {
          const cp = c.codePointAt(0)!;
          return ranges.some(([lo, hi]) => lo <= cp && cp <= hi) !== negated;
        },
      });
    } else {
      if (c === "\\") c = chars[i++] ?? badPattern();
      const literal = c;
      tokens.push({ accepts: (c) => c === literal });
    }
  }
  return (name: string) => {
    const chars = Array.from(name);
    let previous = new Uint8Array(chars.length + 1);
    previous[0] = 1;
    for (const token of tokens) {
      const next = new Uint8Array(chars.length + 1);
      if (token === "*") next[0] = previous[0];
      for (let j = 1; j <= chars.length; j++) {
        next[j] =
          token === "*"
            ? Number(
                Boolean(previous[j] || (next[j - 1] && chars[j - 1] !== "/")),
              )
            : Number(Boolean(previous[j - 1] && token.accepts(chars[j - 1])));
      }
      previous = next;
    }
    return previous[chars.length] === 1;
  };
}

interface GlobFS {
  exists(name: string): boolean;
  readDir(name: string): string[];
}

// Follow Go's directory-by-directory traversal, including implicit directories,
// lexical ordering, dot files, and non-recursive **. Use a stack, not recursion.
function glob(fs: GlobFS, pattern: string): string[] {
  const pending: string[] = [];
  let dirs: string[];
  while (true) {
    if (pending.length > 10000) badPattern();
    compileMatch(pattern); // Validate even when no directory or file exists.
    if (!hasMeta(pattern)) {
      dirs = fs.exists(pattern) ? [pattern] : [];
      break;
    }
    const slash = pattern.lastIndexOf("/");
    const file = pattern.slice(slash + 1);
    const dir = slash < 0 ? "." : pattern.slice(0, slash);
    pending.push(file);
    if (!hasMeta(dir)) {
      dirs = [dir];
      break;
    }
    if (dir === pattern) badPattern();
    pattern = dir;
  }
  while (pending.length) {
    const file = pending.pop()!;
    const matches: string[] = [];
    for (const dir of dirs) {
      const entries = fs.readDir(dir).sort(compare);
      // Go only matches this component when directory entries are available.
      if (!entries.length) continue;
      const match = compileMatch(file);
      for (const name of entries)
        if (match(name)) matches.push(posix.join(dir, name));
    }
    dirs = matches;
  }
  return dirs;
}

function memoryFS(files: Record<string, string>): GlobFS {
  const dirs = new Map<string, Set<string>>([[".", new Set()]]);
  for (const name of Object.keys(files)) {
    // io/fs paths are unrooted slash-separated paths without . or .. elements.
    const parts = name.split("/");
    if (parts.some((p) => !p || p === "." || p === "..")) continue;
    for (let i = 0; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/") || ".";
      if (!dirs.has(dir)) dirs.set(dir, new Set());
      dirs.get(dir)!.add(parts[i]);
    }
  }
  return {
    exists: (name) =>
      dirs.has(name) ||
      (Object.hasOwn(files, name) &&
        name.split("/").every((p) => p && p !== "." && p !== "..")),
    readDir: (name) =>
      Object.hasOwn(files, name) ? [] : [...(dirs.get(name) ?? [])],
  };
}

export function memoryGlob(
  files: Record<string, string>,
  pattern: string,
): string[] {
  return glob(memoryFS(files), pattern);
}

export function fsNames(fs: TemplateFS, patterns: string[]): string[] {
  if (!patterns.length) throw Error("no files named in call to ParseFiles");
  const files: string[] = [];
  for (const pattern of patterns) {
    const names =
      "glob" in fs && typeof fs.glob === "function"
        ? fs.glob(pattern)
        : memoryGlob(fs as Record<string, string>, pattern);
    if (!names.length) throw Error(`pattern matches no files: ${pattern}`);
    files.push(...names);
  }
  return files;
}
