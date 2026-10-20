// Token kinds and byte offsets correspond to Go's text/template/parse lexer.
export interface Item {
  type: string;
  value: string;
  pos: number;
  line: number;
}
export function lex(
  input: string,
  left = "{{",
  right = "}}",
  emitComment = true,
): Item[] {
  const items: Item[] = [];
  let i = 0,
    inside = false,
    depth = 0;
  const space = (c: string) => !!c && /[ \t\r\n]/.test(c);
  const alpha = (c: string) => !!c && /[\p{L}\p{N}_]/u.test(c);
  const emit = (
    type: string,
    start: number,
    end = i,
    value = input.slice(start, end),
  ) =>
    items.push({
      type,
      value,
      pos: Buffer.byteLength(input.slice(0, start)),
      line: input.slice(0, start).split("\n").length,
    });
  const fail = (message: string, start = i) => {
    emit("error", start, i, message);
    return items;
  };
  const terminator = () =>
    i === input.length ||
    space(input[i]) ||
    ".,|:()".includes(input[i]) ||
    input.startsWith(right, i);
  const trimmedRight = () =>
    space(input[i]) && input[i + 1] === "-" && input.startsWith(right, i + 2);
  const scanNumber = () => {
    if ("+-".includes(input[i] ?? "!")) i++;
    let digits = "0123456789_";
    if (input[i] === "0") {
      i++;
      if (/[xX]/.test(input[i] ?? "!")) {
        i++;
        digits += "abcdefABCDEF";
      } else if (/[oO]/.test(input[i] ?? "!")) {
        i++;
        digits = "01234567_";
      } else if (/[bB]/.test(input[i] ?? "!")) {
        i++;
        digits = "01_";
      }
    }
    while (i < input.length && digits.includes(input[i])) i++;
    if (input[i] === ".") {
      i++;
      while (i < input.length && digits.includes(input[i])) i++;
    }
    if (
      (digits.length === 11 && /[eE]/.test(input[i] ?? "!")) ||
      (digits.length === 23 && /[pP]/.test(input[i] ?? "!"))
    ) {
      i++;
      if ("+-".includes(input[i] ?? "!")) i++;
      while (/[\d_]/.test(input[i] ?? "!")) i++;
    }
    if (input[i] === "i") i++;
    if (alpha(input[i])) {
      i++;
      return false;
    }
    return true;
  };
  while (i < input.length || inside) {
    if (!inside) {
      let end = input.indexOf(left, i);
      if (end < 0) end = input.length;
      const start = i;
      let textEnd = end;
      const trimLeft =
        input[end + left.length] === "-" && space(input[end + left.length + 1]);
      if (trimLeft) while (textEnd > i && space(input[textEnd - 1])) textEnd--;
      if (textEnd > i) emit("item20", start, textEnd);
      i = end;
      if (i === input.length) break;
      const leftStart = i;
      i += left.length;
      if (trimLeft) i += 2;
      if (input.startsWith("/*", i)) {
        const commentStart = i,
          close = input.indexOf("*/", i + 2);
        if (close < 0) return fail("unclosed comment", commentStart);
        i = close + 2;
        const endComment = i,
          trim = trimmedRight();
        if (!input.startsWith(right, i) && !trim)
          return fail("comment ends before closing delimiter", commentStart);
        if (emitComment) emit("comment", commentStart, endComment);
        if (trim) i += 2;
        i += right.length;
        if (trim) while (space(input[i])) i++;
        continue;
      }
      emit("left delim", leftStart, leftStart + left.length);
      inside = true;
      depth = 0;
      continue;
    }
    if (input.startsWith(right, i) || trimmedRight()) {
      if (depth) return fail("unclosed left paren");
      const trim = trimmedRight();
      if (trim) i += 2;
      const start = i;
      i += right.length;
      emit("right delim", start);
      if (trim) while (space(input[i])) i++;
      inside = false;
      continue;
    }
    if (i >= input.length) return fail("unclosed action");
    const start = i,
      c = input[i++];
    if (space(c)) {
      while (space(input[i])) i++;
      if (input[i] === "-" && input.startsWith(right, i + 1)) i--;
      if (i > start) emit("space", start);
      continue;
    }
    if (c === ":") {
      if (input[i++] !== "=") return fail("expected :=", start);
      emit(":=", start);
      continue;
    }
    if (c === "=" || c === "|") {
      emit(c === "=" ? "item6" : "pipe", start);
      continue;
    }
    if (c === "(") {
      depth++;
      emit("(", start);
      continue;
    }
    if (c === ")") {
      if (--depth < 0) return fail("unexpected right paren", start);
      emit(")", start);
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let closed = false;
      while (i < input.length) {
        const ch = input[i++];
        if (ch === c) {
          closed = true;
          break;
        }
        if (c !== "`" && ch === "\n") break;
        if (ch === "\\" && c !== "`") {
          if (input[i] === "\n" || i >= input.length) break;
          i++;
        }
      }
      if (!closed)
        return fail(
          c === "`"
            ? "unterminated raw quoted string"
            : c === "'"
              ? "unterminated character constant"
              : "unterminated quoted string",
          start,
        );
      emit(
        c === "`" ? "raw string" : c === "'" ? "charconst" : "string",
        start,
      );
      continue;
    }
    if (/[+\-\d]/.test(c) || (c === "." && /\d/.test(input[i] ?? "!"))) {
      i = start;
      if (!scanNumber())
        return fail(
          "bad number syntax: " + JSON.stringify(input.slice(start, i)),
          start,
        );
      let type = "number";
      if ("+-".includes(input[i] ?? "!")) {
        if (!scanNumber() || input[i - 1] !== "i")
          return fail(
            "bad number syntax: " + JSON.stringify(input.slice(start, i)),
            start,
          );
        type = "complex";
      }
      emit(type, start);
      continue;
    }
    if (c === "." || c === "$" || alpha(c)) {
      while (alpha(input[i])) i++;
      if (!terminator()) {
        const code = input.codePointAt(i)!;
        return fail(
          "bad character U+" +
            code.toString(16).toUpperCase().padStart(4, "0") +
            " '" +
            input[i] +
            "'",
          start,
        );
      }
      const word = input.slice(start, i);
      let type =
        c === "$"
          ? "variable"
          : c === "."
            ? word === "."
              ? "."
              : "field"
            : word === "true" || word === "false"
              ? "bool"
              : "block break continue define else end if nil range template with"
                    .split(" ")
                    .includes(word)
                ? word
                : "identifier";
      emit(type, start);
      continue;
    }
    if (c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126) {
      emit("char", start);
      continue;
    }
    return fail(
      "unrecognized character in action: U+" +
        c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"),
      start,
    );
  }
  emit("EOF", i, i, "");
  return items;
}
