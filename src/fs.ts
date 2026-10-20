export type TemplateFS =
  | Record<string, string>
  | { readFile(name: string): string; glob(pattern: string): string[] };

// Go path.Match syntax, with Unicode code points rather than UTF-16 units.
// Glob matches directory entries, so no wildcard may cross a separator.
function patternRegexp(pattern: string): RegExp {
  const chars = Array.from(pattern);
  let i = 0;
  let source = "";
  const bad = (): never => {
    throw Error("syntax error in pattern");
  };
  const literal = (c: string) => `\\u{${c.codePointAt(0)!.toString(16)}}`;
  const classChar = (): string => {
    let c = chars[i++];
    if (c === undefined || c === "-" || c === "]") return bad();
    if (c === "\\") c = chars[i++] ?? bad();
    if (i === chars.length) return bad();
    return c;
  };
  while (i < chars.length) {
    const c = chars[i++];
    if (c === "*") source += "[^/]*";
    else if (c === "?") source += "[^/]";
    else if (c === "\\") source += literal(chars[i++] ?? bad());
    else if (c === "[") {
      const negated = chars[i] === "^";
      if (negated) i++;
      let ranges = "";
      do {
        const lo = classChar();
        let hi = lo;
        if (chars[i] === "-") {
          i++;
          hi = classChar();
        }
        // Reversed ranges are valid in Go, but contain no characters.
        if (lo.codePointAt(0)! <= hi.codePointAt(0)!)
          ranges += literal(lo) + (lo === hi ? "" : "-" + literal(hi));
      } while (chars[i] !== "]");
      i++;
      source += ranges
        ? `(?!/)[${negated ? "^" : ""}${ranges}]`
        : negated
          ? "[^/]"
          : "(?!)";
    } else source += literal(c);
  }
  return new RegExp(`^(?:${source})(?![\\s\\S])`, "u");
}

export function fsNames(fs: TemplateFS, patterns: string[]): string[] {
  if (!patterns.length) throw Error("no files named in call to ParseFiles");
  const files: string[] = [];
  for (const pattern of patterns) {
    let names: string[];
    if ("glob" in fs && typeof fs.glob === "function") names = fs.glob(pattern);
    else {
      const re = patternRegexp(pattern);
      names = Object.keys(fs)
        .filter((name) => re.test(name))
        .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    }
    if (!names.length) throw Error(`pattern matches no files: ${pattern}`);
    files.push(...names);
  }
  return files;
}
