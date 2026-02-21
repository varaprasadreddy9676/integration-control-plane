export const formatSingleLineScript = (code: string) => {
  let indent = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escape = false;
  let result = '';
  let line = '';

  const pushLine = () => {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      result += `${' '.repeat(indent)}${trimmed}\n`;
    }
    line = '';
  };

  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    const next = code[i + 1];

    if (inLineComment) {
      line += ch;
      if (ch === '\n') {
        inLineComment = false;
        pushLine();
      }
      continue;
    }

    if (inBlockComment) {
      line += ch;
      if (ch === '*' && next === '/') {
        line += '/';
        i += 1;
        inBlockComment = false;
      }
      continue;
    }

    if (inSingle || inDouble || inTemplate) {
      line += ch;
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (inSingle && ch === '\'') inSingle = false;
      if (inDouble && ch === '"') inDouble = false;
      if (inTemplate && ch === '`') inTemplate = false;
      continue;
    }

    if (ch === '/' && next === '/') {
      inLineComment = true;
      line += ch;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      line += ch;
      continue;
    }

    if (ch === '\'') {
      inSingle = true;
      line += ch;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      line += ch;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      line += ch;
      continue;
    }

    if (ch === '{') {
      line += ch;
      pushLine();
      indent += 2;
      continue;
    }
    if (ch === '}') {
      pushLine();
      indent = Math.max(indent - 2, 0);
      line += ch;
      pushLine();
      continue;
    }
    if (ch === ';') {
      line += ch;
      pushLine();
      continue;
    }

    line += ch;
  }

  if (line.trim().length > 0) {
    pushLine();
  }

  return result.trim();
};

export const formatScriptForDisplay = (script?: string) => {
  if (!script) return '';
  let normalized = script;
  if (normalized.includes('\\n') && !normalized.includes('\n')) {
    normalized = normalized.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r');
  }
  if (!normalized.includes('\n') && normalized.length > 160) {
    return formatSingleLineScript(normalized);
  }
  return normalized;
};
